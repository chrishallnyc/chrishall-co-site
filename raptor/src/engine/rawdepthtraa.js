// Adapted from Three.js r185 TRAANode.setup; Copyright 2010–2026 three.js authors.
// Distributed under the MIT license in ../../vendor/LICENSE.
// Raw reverse-depth velocity selection for pinned Three r185 TRAA.
// The owned setup is kept equivalent to vendor setup except for the current
// nearest/farthest ordering. History validity, color resolve, lifecycle,
// allocations, jitter, and all inherited update/copy behavior stay native.
import TRAANode from "../../vendor/display/TRAANode.js";
import { FloatType, Vector2 } from "three";
import { add, float, If, Fn, max, texture, uv, vec2, vec4, luminance, velocity, getViewPosition, viewZToPerspectiveDepth, struct, ivec2, mix, logarithmicDepthToViewZ, viewZToOrthographicDepth } from "three/tsl";
const _size = new Vector2();
export default class RawDepthTRAANode extends TRAANode {
  rawDepthSelection = true;
	setup( builder ) {

		// Only reverse float depth needs this ordering correction. Preserve the
		// native graph for forward/log depth and the explicit comparison mode.
		if ( ! this.rawDepthSelection || ! builder.renderer.reversedDepthBuffer || builder.renderer.logarithmicDepthBuffer ) {
			return super.setup( builder );
		}

		const renderPipeline = builder.context.renderPipeline;

		if ( renderPipeline ) {

			this._needsPostProcessingSync = true;

			renderPipeline.context.onBeforeRenderPipeline = () => {

				const size = builder.renderer.getDrawingBufferSize( _size );
				this.setViewOffset( size.width, size.height );

			};

			renderPipeline.context.onAfterRenderPipeline = () => {

				this.clearViewOffset();

			};

		}

		if ( builder.renderer.reversedDepthBuffer === true ) {

			this._historyRenderTarget.depthTexture.type = FloatType;

		}

		if ( builder.context.velocity !== undefined ) {

			this._velocityNode = builder.context.velocity;

		} else {

			this._velocityNode = velocity;

		}

		const logarithmicToPerspectiveDepth = ( depth ) => {

			const { x: near, y: far } = this._cameraNearFar;
			const viewZ = logarithmicDepthToViewZ( depth, near, far );
			return viewZToPerspectiveDepth( viewZ, near, far );

		};

		const currentDepthStruct = struct( {

			closestDepth: 'float',
			closestPositionTexel: 'vec2',
			farthestDepth: 'float',

		} );

		// Samples 3×3 neighborhood pixels and returns the closest and farthest depths.
		const sampleCurrentDepth = Fn( ( [ positionTexel ] ) => {

			const closestDepth = float( - 1 ).toVar();
			const closestPositionTexel = vec2( 0 ).toVar();
			const farthestDepth = float( 2 ).toVar();

			for ( let x = - 1; x <= 1; ++ x ) {

				for ( let y = - 1; y <= 1; ++ y ) {

					const neighbor = positionTexel.add( vec2( x, y ) ).toVar();
					let depth = this.depthNode.load( neighbor ).r;
					if ( builder.renderer.logarithmicDepthBuffer ) depth = logarithmicToPerspectiveDepth( depth );
					depth = depth.toVar();

					If( depth.greaterThan( closestDepth ), () => {

						closestDepth.assign( depth );
						closestPositionTexel.assign( neighbor );

					} );

					If( depth.lessThan( farthestDepth ), () => {

						farthestDepth.assign( depth );

					} );

				}

			}

			// Convert only after selecting velocity from raw reverse depth.
			// History acceptance below keeps its original normalized convention.
			return currentDepthStruct( closestDepth.oneMinus(), closestPositionTexel, farthestDepth.oneMinus() );

		} );

		// Samples a previous depth and reproject it using the current camera matrices.
		const samplePreviousDepth = ( uv ) => {

			let depth = this._previousDepthNode.sample( uv ).r;
			if ( builder.renderer.logarithmicDepthBuffer ) depth = logarithmicToPerspectiveDepth( depth );
			const positionView = getViewPosition( uv, depth, this._previousCameraProjectionMatrixInverse );
			const positionWorld = this._previousCameraWorldMatrix.mul( vec4( positionView, 1 ) ).xyz;
			const viewZ = this._cameraWorldMatrixInverse.mul( vec4( positionWorld, 1 ) ).z;
			return this.camera.isOrthographicCamera
				? viewZToOrthographicDepth( viewZ, this._cameraNearFar.x, this._cameraNearFar.y )
				: viewZToPerspectiveDepth( viewZ, this._cameraNearFar.x, this._cameraNearFar.y );

		};

		// Optimized version of AABB clipping.
		// Reference: https://github.com/playdeadgames/temporal
		const clipAABB = Fn( ( [ currentColor, historyColor, minColor, maxColor ] ) => {

			const pClip = maxColor.rgb.add( minColor.rgb ).mul( 0.5 );
			const eClip = maxColor.rgb.sub( minColor.rgb ).mul( 0.5 ).add( 1e-7 );
			const vClip = historyColor.sub( vec4( pClip, currentColor.a ) );
			const vUnit = vClip.xyz.div( eClip );
			const absUnit = vUnit.abs();
			const maxUnit = max( absUnit.x, absUnit.y, absUnit.z );
			return maxUnit.greaterThan( 1 ).select(
				vec4( pClip, currentColor.a ).add( vClip.div( maxUnit ) ),
				historyColor
			);

		} ).setLayout( {
			name: 'clipAABB',
			type: 'vec4',
			inputs: [
				{ name: 'currentColor', type: 'vec4' },
				{ name: 'historyColor', type: 'vec4' },
				{ name: 'minColor', type: 'vec4' },
				{ name: 'maxColor', type: 'vec4' }
			]
		} );

		// Performs variance clipping.
		// See: https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf
		const varianceClipping = Fn( ( [ positionTexel, currentColor, historyColor, gamma ] ) => {

			const offsets = [
				[ - 1, - 1 ],
				[ - 1, 1 ],
				[ 1, - 1 ],
				[ 1, 1 ],
				[ 1, 0 ],
				[ 0, - 1 ],
				[ 0, 1 ],
				[ - 1, 0 ]
			];

			const moment1 = currentColor.toVar();
			const moment2 = currentColor.pow2().toVar();

			for ( const [ x, y ] of offsets ) {

				// Use max() to prevent NaN values from propagating.
				const neighbor = this.beautyNode.offset( ivec2( x, y ) ).load( positionTexel ).max( 0 );
				moment1.addAssign( neighbor );
				moment2.addAssign( neighbor.pow2() );

			}

			const N = float( offsets.length + 1 );
			const mean = moment1.div( N );
			const variance = moment2.div( N ).sub( mean.pow2() ).max( 0 ).sqrt().mul( gamma );
			const minColor = mean.sub( variance );
			const maxColor = mean.add( variance );

			return clipAABB( mean.clamp( minColor, maxColor ), historyColor, minColor, maxColor );

		} );

		// Returns the amount of subpixel (expressed within [0, 1]) in the velocity.
		const subpixelCorrection = Fn( ( [ velocityUV, textureSize ] ) => {

			const velocityTexel = velocityUV.mul( textureSize );
			const phase = velocityTexel.fract().abs();
			const weight = max( phase, phase.oneMinus() );
			return weight.x.mul( weight.y ).oneMinus().div( 0.75 );

		} ).setLayout( {
			name: 'subpixelCorrection',
			type: 'float',
			inputs: [
				{ name: 'velocityUV', type: 'vec2' },
				{ name: 'textureSize', type: 'ivec2' }
			]
		} );

		// Flicker reduction based on luminance weighing.
		const flickerReduction = Fn( ( [ currentColor, historyColor, currentWeight ] ) => {

			const historyWeight = currentWeight.oneMinus();
			const compressedCurrent = currentColor.mul( float( 1 ).div( ( max( currentColor.r, currentColor.g, currentColor.b ).add( 1 ) ) ) );
			const compressedHistory = historyColor.mul( float( 1 ).div( ( max( historyColor.r, historyColor.g, historyColor.b ).add( 1 ) ) ) );

			const luminanceCurrent = luminance( compressedCurrent.rgb );
			const luminanceHistory = luminance( compressedHistory.rgb );

			currentWeight.mulAssign( float( 1 ).div( luminanceCurrent.add( 1 ) ) );
			historyWeight.mulAssign( float( 1 ).div( luminanceHistory.add( 1 ) ) );

			return add( currentColor.mul( currentWeight ), historyColor.mul( historyWeight ) ).div( max( currentWeight.add( historyWeight ), 0.00001 ) ).toVar();

		} );

		const historyNode = texture( this._historyRenderTarget.texture );

		const resolve = Fn( () => {

			const uvNode = uv();
			const textureSize = this.beautyNode.size(); // Assumes all the buffers share the same size.
			const positionTexel = uvNode.mul( textureSize );

			// sample the closest and farthest depths in the current buffer

			const currentDepth = sampleCurrentDepth( positionTexel );
			const closestDepth = currentDepth.get( 'closestDepth' );
			const closestPositionTexel = currentDepth.get( 'closestPositionTexel' );
			const farthestDepth = currentDepth.get( 'farthestDepth' );

			// convert the NDC offset to UV offset

			const offsetUV = this.velocityNode.load( closestPositionTexel ).xy.mul( vec2( 0.5, - 0.5 ) );

			// sample the previous depth

			const historyUV = uvNode.sub( offsetUV );
			const previousDepth = samplePreviousDepth( historyUV );

			// history is considered valid when the UV is in range and there's no disocclusion except on edges

			const isValidUV = historyUV.greaterThanEqual( 0 ).all().and( historyUV.lessThanEqual( 1 ).all() );
			const isEdge = farthestDepth.sub( closestDepth ).greaterThan( this.edgeDepthDiff );
			const isDisocclusion = closestDepth.sub( previousDepth ).greaterThan( this.depthThreshold );
			const hasValidHistory = isValidUV.and( isEdge.or( isDisocclusion.not() ) );

			// sample the current and previous colors

			const currentColor = this.beautyNode.sample( uvNode );
			const historyColor = historyNode.sample( uvNode.sub( offsetUV ) );

			// increase the weight towards the current frame under motion

			const motionFactor = uvNode.sub( historyUV ).mul( textureSize ).length().div( this.maxVelocityLength ).saturate();
			const currentWeight = float( 0.05 ).toVar(); // A minimum weight

			if ( this.useSubpixelCorrection ) {

				// Increase the minimum weight towards the current frame when the velocity is more subpixel.
				currentWeight.addAssign( subpixelCorrection( offsetUV, textureSize ).mul( 0.25 ) );

			}

			currentWeight.assign( hasValidHistory.select( currentWeight.add( motionFactor ).saturate(), 1 ) );

			// Perform neighborhood clipping/clamping. We use variance clipping here.

			const varianceGamma = mix( 0.5, 1, motionFactor.oneMinus().pow2() ); // Reasonable gamma range is [0.75, 2]
			const clippedHistoryColor = varianceClipping( positionTexel, currentColor, historyColor, varianceGamma );

			// flicker reduction based on luminance weighing

			const output = flickerReduction( currentColor, clippedHistoryColor, currentWeight );

			return output;

		} );

		// materials

		this._resolveMaterial.colorNode = resolve();

		return this._textureNode;

	}
}
