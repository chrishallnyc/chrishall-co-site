// Clouds have their own depth and camera motion. Reprojecting their composite
// with the terrain behind them makes nearby billows smear during flight.
// This pass shares one cloud march across color, velocity, and fragment depth.

import * as THREE from "three";
import {
  Fn, uniform, mrt, passTexture, NodeUpdateType,
} from "three/tsl";
import { volCloudsNode } from "./volclouds.js";
import { cloudTemporalResult } from "./cloudtemporal.js";
const CUT_DISTANCE_SQ = 250 * 250;
const CUT_ROTATION_DOT = Math.cos(35 * Math.PI / 360);

export class CloudPass extends THREE.TempNode {
  static get type() { return "CloudPass"; }

  constructor({ beauty, depth, velocity, camera, ...cloudOptions }) {
    super("vec4");
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.beauty = beauty;
    this.sceneDepth = depth;
    this.sceneVelocity = velocity;
    this.camera = camera;
    this.cloudOptions = cloudOptions;

    // Stock TRAA copies depth into its history DepthTexture. A color texture
    // containing packed depth cannot satisfy that GPU texture-copy contract.
    this.renderTarget = new THREE.RenderTarget(1, 1, {
      count: 2, type: THREE.HalfFloatType, depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.renderTarget.textures[0].name = "output";
    this.renderTarget.textures[1].name = "velocity";
    this.renderTarget.depthTexture.name = "depth";
    this._textureNodes = {
      output: passTexture(this, this.renderTarget.textures[0]),
      velocity: passTexture(this, this.renderTarget.textures[1]),
      depth: passTexture(this, this.renderTarget.depthTexture),
    };

    this._material = new THREE.NodeMaterial();
    this._material.name = "Cloud composition";
    this._material.depthWrite = true;
    this._material.depthTest = true;
    this._material.depthFunc = THREE.AlwaysDepth;
    this._quad = new THREE.QuadMesh(this._material);
    this._quad.name = "Cloud composition";

    this._size = new THREE.Vector2();
    this._unjitteredCamera = camera.clone();
    this._currentClip = uniform(new THREE.Matrix4());
    this._previousClip = uniform(new THREE.Matrix4());
    this._cameraView = uniform(new THREE.Matrix4());
    this._nearFar = uniform(new THREE.Vector2(camera.near, camera.far));
    this._resetHistory = uniform(true);
    this._lastClip = new THREE.Matrix4();
    this._lastPosition = new THREE.Vector3();
    this._lastRotation = new THREE.Quaternion();
    this._lastProjection = { fov: camera.fov, zoom: camera.zoom, near: camera.near, far: camera.far };
    this._historyValid = false;
    this._rendererState = undefined;
  }

  get mode() { return "native"; }
  get cloudScale() { return 1; }

  getTextureNode(name = "output") { return this._textureNodes[name]; }

  // The next frame sends history UVs outside the image through the ordinary
  // velocity input. TRAA then uses only current color and refreshes its depth
  // history, without depending on private vendor fields or replacing hooks.
  invalidateHistory() {
    this._historyValid = false;
    return this;
  }

  _updateCamera(width, height) {
    const camera = this.camera;
    if (this.renderTarget.width !== width || this.renderTarget.height !== height) {
      this.renderTarget.setSize(width, height);
      this.invalidateHistory();
    }
    if (this._historyValid) {
      const previous = this._lastProjection;
      const cut = camera.position.distanceToSquared(this._lastPosition) > CUT_DISTANCE_SQ
        || Math.abs(camera.quaternion.dot(this._lastRotation)) < CUT_ROTATION_DOT
        || Math.abs(camera.fov - previous.fov) > 8
        || Math.abs(camera.zoom - previous.zoom) > 0.1
        || camera.near !== previous.near || camera.far !== previous.far;
      if (cut) this.invalidateHistory();
    }

    // Density rays use the scene's jittered inverse projection. Motion uses
    // unjittered matrices, just like Three's velocity MRT. Copying the camera
    // avoids changing the live projection while TRAA owns its view offset.
    this._unjitteredCamera.copy(camera, false);
    this._unjitteredCamera.clearViewOffset();
    this._cameraView.value.copy(camera.matrixWorldInverse);
    this._currentClip.value.multiplyMatrices(
      this._unjitteredCamera.projectionMatrix, camera.matrixWorldInverse,
    );
    this._previousClip.value.copy(this._historyValid ? this._lastClip : this._currentClip.value);
    this._nearFar.value.set(camera.near, camera.far);
    this._resetHistory.value = !this._historyValid;
  }

  _storeCamera() {
    const camera = this.camera;
    this._lastClip.copy(this._currentClip.value);
    this._lastPosition.copy(camera.position);
    this._lastRotation.copy(camera.quaternion);
    Object.assign(this._lastProjection, {
      fov: camera.fov, zoom: camera.zoom, near: camera.near, far: camera.far,
    });
    this._historyValid = true;
  }

  setup(builder) {
    // r185 reverses AlwaysDepth into NeverDepth. WebGPU supports
    // unconditional fragment-depth writes when depth testing is disabled.
    const reversed = builder.renderer.reversedDepthBuffer === true;
    this._material.depthTest = !reversed;
    if (builder.renderer.logarithmicDepthBuffer) {
      throw new Error("CloudPass requires standard perspective depth.");
    }
    if (reversed) this.renderTarget.depthTexture.type = THREE.FloatType;

    const cloudResult = volCloudsNode({
      beauty: this.beauty, depth: this.sceneDepth, camera: this.camera,
      ...this.cloudOptions,
      emit: (result) => cloudTemporalResult(this, result, reversed),
    });

    // Keep MRT as the direct fragment node: wrapping it in context hides its
    // output-struct type in r185. Apply context to the shared march instead.
    const result = Fn(() => cloudResult.toVar("cloudCompositeResult"))().context(builder.getSharedContext());
    this._material.fragmentNode = mrt({ output: result.get("color"), velocity: result.get("motion") });
    this._material.depthNode = result.get("depth");
    this._material.needsUpdate = true;
    return this._textureNodes.output;
  }

  updateBefore(frame) {
    const { renderer } = frame;
    const size = renderer.getDrawingBufferSize(this._size);
    this._updateCamera(size.width, size.height);
    this._rendererState = THREE.RendererUtils.resetRendererState(renderer, this._rendererState);
    try {
      renderer.setMRT(null);
      renderer.setRenderTarget(this.renderTarget);
      this._quad.render(renderer);
      this._storeCamera();
    } finally {
      THREE.RendererUtils.restoreRendererState(renderer, this._rendererState);
    }
  }

  dispose() {
    this.renderTarget.dispose();
    this._material.dispose();
  }
}
