"""Bounded-distance contact AO. Run Blender --background --python ... --.

Outputs are separate authoring files. No production ORM is modified here.
The UV audit/layer composition handles shared receiver charts; the coating
baker packs accepted sources later. Geometry must be frozen for a final bake.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import bpy
import numpy as np


def options():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--radius", type=float, default=.25)
    parser.add_argument("--strength", type=float, default=.65)
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--audit-only", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def uv_audit(data, width, height):
    reports = {}
    data['_neutralMasks'] = {}
    for atlas in ("body", "lifting"):
        owner = np.full((height, width), -1, dtype=np.int32)
        point = np.zeros((height, width, 3), dtype=np.float32)
        normal = np.zeros_like(point)
        overlaps = np.zeros((height, width), dtype=bool)
        conflicts = np.zeros_like(overlaps)
        neutral_mask = np.zeros_like(overlaps)
        pairs, labels, label_ids = {}, [], {}
        layers = [np.zeros((height,width),dtype=bool)]
        degenerate = outside = 0
        for mesh_id, mesh in enumerate(data["meshes"]):
            if mesh["atlas"] != atlas:
                continue
            mesh['bakeLayers'] = [-1] * len(mesh['faces'])
            positions = np.asarray(mesh["positions"]).reshape(-1, 3)
            normals = np.asarray(mesh["normals"]).reshape(-1, 3)
            coords = np.asarray(mesh["uv"]).reshape(-1, 2)
            surface_names = [mesh['path']] * len(mesh['faces'])
            for component in mesh.get('components', []):
                start, count = component['firstTriangle'], component['triangles']
                surface_names[start:start+count] = [mesh['path']+'/'+component['name']] * count
            neutral_faces = mesh.get('neutralAO',[False]*len(mesh['faces']))
            for face_id, (ids, receiver) in enumerate(zip(mesh["faces"], mesh["receivers"])):
                neutral = neutral_faces[face_id]
                if not receiver and not neutral:
                    continue
                if receiver:
                    mesh['bakeLayers'][face_id] = 0
                label = surface_names[face_id]
                if label not in label_ids:
                    label_ids[label] = len(labels)
                    labels.append(label)
                surface_id = label_ids[label]
                tri = coords[ids] * [width, height]
                if np.any(tri < 0) or np.any(tri > [width, height]):
                    outside += 1
                x0, y0 = np.maximum(0, np.ceil(tri.min(axis=0) - .5)).astype(int)
                x1, y1 = np.minimum([width-1, height-1], np.floor(tri.max(axis=0) - .5)).astype(int)
                if x1 < x0 or y1 < y0:
                    continue
                a, b, c = tri
                denominator = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(denominator) < 1e-9:
                    degenerate += 1
                    continue
                y, x = np.mgrid[y0:y1+1, x0:x1+1]
                u = ((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1])) / denominator
                v = ((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1])) / denominator
                w = 1-u-v
                inside = ((u >= -1e-7) & (v >= -1e-7) & (w >= -1e-7)) if neutral else ((u > 1e-7) & (v > 1e-7) & (w > 1e-7))
                yy, xx = y[inside], x[inside]
                if not len(xx):
                    continue
                if neutral:
                    neutral_mask[yy,xx] = True
                    continue
                layer = 0
                while layer < len(layers) and np.any(layers[layer][yy,xx]):
                    layer += 1
                if layer == len(layers):
                    layers.append(np.zeros((height,width),dtype=bool))
                if len(layers) > 24:
                    raise RuntimeError('Unexpected UV overlap depth; inspect the export before baking.')
                layers[layer][yy,xx] = True
                mesh['bakeLayers'][face_id] = layer
                weights = np.stack([u[inside], v[inside], w[inside]], axis=1)
                world = weights @ positions[ids]
                direction = weights @ normals[ids]
                direction /= np.maximum(1e-12, np.linalg.norm(direction, axis=1, keepdims=True))
                occupied = owner[yy, xx] >= 0
                overlap_ids = np.flatnonzero(occupied)
                overlaps[yy[occupied], xx[occupied]] = True
                if len(overlap_ids):
                    distance = np.linalg.norm(point[yy, xx]-world, axis=1)
                    alignment = np.sum(normal[yy, xx]*direction, axis=1)
                    mismatch = occupied & ((distance > .002) | (alignment < .995))
                    conflicts[yy[mismatch], xx[mismatch]] = True
                    for previous in np.unique(owner[yy[mismatch], xx[mismatch]]):
                        key = tuple(sorted((int(previous), surface_id)))
                        pairs[key] = pairs.get(key, 0) + int(np.sum(owner[yy[mismatch], xx[mismatch]] == previous))
                vacant = ~occupied
                owner[yy[vacant], xx[vacant]] = surface_id
                point[yy[vacant], xx[vacant]] = world[vacant]
                normal[yy[vacant], xx[vacant]] = direction[vacant]
        covered = int(np.sum(owner >= 0))
        data['_neutralMasks'][atlas] = neutral_mask
        reports[atlas] = {"resolution":[width,height], "coveredPixels":covered,
            "neutralizedProjectedPixels":int(neutral_mask.sum()),
            "neutralizedConflictingPixels":int(np.sum(neutral_mask & (owner >= 0))),
            "overlapPixels":int(overlaps.sum()), "conflictingPixels":int(conflicts.sum()),
            "conflictFraction":float(conflicts.sum()/max(1, covered)),
            "degenerateUVTriangles":degenerate, "outsideAtlasTriangles":outside,
            "bakeLayers":len(layers), "layerTriangles":[sum(mesh.get('bakeLayers',[]).count(i)
                for mesh in data['meshes'] if mesh['atlas'] == atlas) for i in range(len(layers))],
            "conflicts":[{"meshes":[labels[a],labels[b]],"samples":count}
                for (a,b),count in sorted(pairs.items(), key=lambda entry:-entry[1])[:12]]}
    return reports


def image(name, width, height):
    result = bpy.data.images.new(name, width, height, alpha=True, float_buffer=True, is_data=True)
    result.generated_color = (1,1,1,0)
    result.colorspace_settings.name = 'Non-Color'
    return result


def material(name, target, radius, samples, calibration=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    source = nodes.new('ShaderNodeTexCoord' if calibration else 'ShaderNodeAmbientOcclusion')
    if not calibration:
        source.inputs['Distance'].default_value = radius
        source.samples = samples
        source.only_local = False
        source.inside = False
    links.new(source.outputs['UV' if calibration else 'AO'], emission.inputs['Color'])
    links.new(emission.outputs[0], output.inputs['Surface'])
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = target
    nodes.active = texture
    texture.select = True
    return mat


def make_mesh(name, records, selected_atlas=None, layer=None):
    vertices, normals, coords, faces = [], [], [], []
    for record in records:
        if selected_atlas is None:
            wanted = [face for face, receiver in zip(record['faces'],record['receivers']) if not receiver]
        else:
            wanted = [face for i,(face, receiver) in enumerate(zip(record['faces'],record['receivers']))
                if receiver and record['atlas'] == selected_atlas and (layer is None or record['bakeLayers'][i] == layer)]
        if not wanted:
            continue
        base = len(vertices)
        vertices.extend(np.asarray(record['positions']).reshape(-1,3).tolist())
        normals.extend(np.asarray(record['normals']).reshape(-1,3).tolist())
        coords.extend(np.asarray(record['uv']).reshape(-1,2).tolist())
        faces.extend([[base+i for i in face] for face in wanted])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name='AuthoredUV')
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            uv.data[loop_index].uv = coords[mesh.loops[loop_index].vertex_index]
    mesh.normals_split_custom_set_from_vertices(normals)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def bake(obj, target, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='EMIT')
    target.file_format = 'PNG'
    target.filepath_raw = str(path)
    target.save()
    values = np.empty(len(target.pixels), dtype=np.float32)
    target.pixels.foreach_get(values)
    return values.reshape(-1,4)


def composite_layers(layers, width, height, margin, neutral_mask):
    # MAX visibility is minimum occlusion: a buried UV duplicate cannot
    # darken the outer skin. Transparent untouched pixels never participate.
    values = np.zeros((height,width,4),dtype=np.float32)
    covered = np.zeros((height,width),dtype=bool)
    for pixels in layers:
        pixels = pixels.reshape(height,width,4)
        mask = pixels[:,:,3] > .5
        values[mask,:3] = np.maximum(values[mask,:3],pixels[mask,:3])
        covered |= mask
    original = int(covered.sum())
    # Fairings remain opaque occluders. Their steep, shared projection must
    # not inherit the hidden boom's darkness. The unique fin chart still
    # records root contact; live self-shadow handles the fairing itself.
    # Include the texture's bilinear footprint. Otherwise neighboring hidden
    # boom texels can leak a thin false crease back onto the neutral fairing.
    neutral_padded = neutral_mask.copy()
    for _ in range(2):
        expanded = neutral_padded.copy()
        expanded[1:,:] |= neutral_padded[:-1,:]
        expanded[:-1,:] |= neutral_padded[1:,:]
        expanded[:,1:] |= neutral_padded[:,:-1]
        expanded[:,:-1] |= neutral_padded[:,1:]
        neutral_padded = expanded
    values[neutral_padded] = 1
    covered |= neutral_padded
    # A projected bevel can occupy only a few texels. Filter sampled contact
    # visibility over one texel (sigma ~.71 px), weighted by actual coverage.
    # Empty atlas pixels never whiten the edge or introduce a dark fringe.
    total = np.zeros_like(values)
    weight = np.zeros((height,width),dtype=np.float32)
    for dy,wy in ((-1,.25),(0,.5),(1,.25)):
        for dx,wx in ((-1,.25),(0,.5),(1,.25)):
            mask = np.roll(covered,(dy,dx),(0,1))
            if dy == 1: mask[0,:] = False
            if dy == -1: mask[-1,:] = False
            if dx == 1: mask[:,0] = False
            if dx == -1: mask[:,-1] = False
            contribution = mask * (wx*wy)
            total += np.roll(values,(dy,dx),(0,1))*contribution[:,:,None]
            weight += contribution
    values[covered] = total[covered]/weight[covered,None]
    values[neutral_padded] = 1
    for _ in range(margin):
        total = np.zeros_like(values)
        count = np.zeros((height,width),dtype=np.float32)
        for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
            mask = np.roll(covered,(dy,dx),(0,1))
            if dy == 1: mask[0,:] = False
            if dy == -1: mask[-1,:] = False
            if dx == 1: mask[:,0] = False
            if dx == -1: mask[:,-1] = False
            total += np.roll(values,(dy,dx),(0,1))*mask[:,:,None]
            count += mask
        extend = ~covered & (count > 0)
        values[extend] = total[extend]/count[extend,None]
        covered |= extend
    values[~covered] = 1
    values[:,:,3] = 1
    return values.reshape(-1,4), original


def main():
    args = options()
    if args.width < 64 or args.width > 2048 or args.width % 2:
        raise ValueError('AO width must be an even integer from 64 to 2048.')
    if not 0 < args.radius <= .5:
        raise ValueError('This contact-AO tool limits the radius to (0, .5] metres.')
    if not 0 <= args.strength <= 1:
        raise ValueError('Packing strength must be between zero and one.')
    if args.final and (args.width != 2048 or args.samples < 32):
        raise ValueError('Final authoring maps require 2048 width and at least 32 samples.')
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads(Path(args.input).read_text())
    if args.final and not data.get('geometrySHA256'):
        raise ValueError('Final maps require a geometry fingerprint from the current exporter.')
    start = time.monotonic()
    report = {'sourceSHA256':data['sourceSHA256'],'geometrySHA256':data.get('geometrySHA256'),
        'provisional':not args.final,'radiusMetres':args.radius,'strength':args.strength,
        'cyclesSamples':args.samples,'aoNodeSamples':16,'blender':bpy.app.version_string,
        'uvAudit':uv_audit(data,args.width,args.width//2)}
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if args.audit_only:
        print('AO_AUDIT '+json.dumps(report))
        return
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 8
    scene.cycles.samples = args.samples
    scene.cycles.seed = 22071997
    scene.render.bake.use_clear = False
    scene.render.bake.margin = 0
    scene.render.bake.margin_type = 'EXTEND'
    scene.view_settings.view_transform = 'Standard'

    # Asymmetric UV calibration proves raw data values and V orientation.
    calibration = {'positions':[0,0,0,1,0,0,1,1,0,0,1,0], 'normals':[0,0,1]*4,
        'uv':[0,0,1,0,1,1,0,1], 'faces':[[0,1,2],[0,2,3]],'receivers':[True,True],'atlas':'calibration'}
    obj = make_mesh('UV calibration',[calibration],'calibration')
    target = image('UV calibration',128,64)
    obj.data.materials.append(material('UV calibration',target,args.radius,16,True))
    values = bake(obj,target,out/'uv-calibration.png')
    probes = []
    for x,y in [(16,8),(96,8),(16,48),(96,48)]:
        actual = values[y*128+x,:3]
        expected = np.array([(x+.5)/128,(y+.5)/64,0])
        probes.append({'pixelBottomLeft':[x,y],'actual':actual.tolist(),'expected':expected.tolist(),
            'pass':bool(np.max(np.abs(actual-expected)) < .015)})
    report['calibration'] = probes
    if not all(probe['pass'] for probe in probes):
        raise RuntimeError('Raw UV calibration failed.')
    bpy.data.objects.remove(obj, do_unlink=True)
    occluders = make_mesh('Opaque non-receiver surfaces',data['meshes'])
    targets = {}
    for atlas in ('body','lifting'):
        targets[atlas] = []
        for layer in range(report['uvAudit'][atlas]['bakeLayers']):
            name = f'{atlas}-layer-{layer}'
            obj = make_mesh(name,data['meshes'],atlas,layer)
            target = image(name,args.width,args.width//2)
            obj.data.materials.append(material(name,target,args.radius,16))
            targets[atlas].append((obj,target))
    report['maps'] = {}
    source_manifest = {'schema':1,'provisional':not args.final,'geometrySHA256':data.get('geometrySHA256'),
        'sourceSHA256':data['sourceSHA256'],'radiusMetres':args.radius,'strength':args.strength,
        'blender':bpy.app.version_string,'cyclesSamples':args.samples,'aoNodeSamples':16,
        'composition':'maximum visibility among covered UV layers',
        'filter':{'type':'coverage-weighted binomial','radiusPixels':1,'sigmaPixels':math.sqrt(.5)},
        'limitations':[{'components':['finRootFairingL','finRootFairingR'],
            'treatment':'Opaque occluders; ambiguous shared body-atlas footprints have neutral AO.',
            'filterFootprintPaddingPixels':2,
            'reason':'Steep projected fairing faces reuse boom UVs and cannot represent independent contact visibility.',
            'retained':'Unique fin-root chart AO, other reliable body contacts and live self-shadowing.'}],
        'maps':{}}
    for atlas,objects in targets.items():
        started = time.monotonic()
        layers = [bake(obj,target,out/f'{atlas}-ao-layer-{i}.png') for i,(obj,target) in enumerate(objects)]
        values, covered = composite_layers(layers,args.width,args.width//2,max(2,args.width//128),data['_neutralMasks'][atlas])
        target = image(atlas,args.width,args.width//2)
        target.pixels.foreach_set(values.ravel())
        target.file_format = 'PNG'
        filename = f'{atlas}-ao.png' if args.final else f'{atlas}-ao-probe.png'
        target.filepath_raw = str(out/filename)
        target.save()
        source_manifest['maps'][atlas] = {'file':filename,'width':args.width,'height':args.width//2,
            'sha256':hashlib.sha256((out/filename).read_bytes()).hexdigest()}
        report['maps'][atlas] = {'seconds':time.monotonic()-started,'minimum':float(values[:,0].min()),
            'mean':float(values[:,0].mean()),'maximum':float(values[:,0].max()),'coveredPixels':covered,
            'composition':'maximum visibility among covered UV layers; one-texel coverage-weighted filter; final-only margin dilation'}
    report['seconds'] = time.monotonic()-start
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (out/'source-manifest.json').write_text(json.dumps(source_manifest,indent=2)+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'probe.blend'))
    print('AO_PROBE '+json.dumps(report))


if __name__ == '__main__':
    main()
