import * as THREE from 'three'
import bake from './room-lighting-bake.json' with { type: 'json' }
import { roomSurfaces } from './RoomLightingLayout.ts'

type LightmapLayers = { stage: number[]; house: number[]; level: number }
const layers = new WeakMap<THREE.DataTexture, LightmapLayers>()

const mixLightmap = (texture: THREE.DataTexture, source: LightmapLayers, level: number) => {
  if (source.level === level) return
  const data = texture.image.data
  if (!(data instanceof Uint16Array)) throw new Error('Invalid baked room lightmap texture storage.')
  for (let pixel = 0; pixel < source.stage.length / 3; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      data[pixel * 4 + channel] = THREE.DataUtils.toHalfFloat(
        source.stage[pixel * 3 + channel] + source.house[pixel * 3 + channel] * level / 100,
      )
    }
    data[pixel * 4 + 3] = THREE.DataUtils.toHalfFloat(1)
  }
  source.level = level
  texture.needsUpdate = true
}

export const attachRoomLightmap = (mesh: THREE.Mesh, surfaceId: string) => {
  const surface = roomSurfaces.find((candidate) => candidate.id === surfaceId)
  const source = bake.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || !source || !(mesh.material instanceof THREE.MeshStandardMaterial)
    || source.stage.length !== source.width * source.height * 3
    || source.house.length !== source.stage.length) {
    throw new Error(`Missing or invalid room lightmap: ${surfaceId}. Run npm run bake:lighting.`)
  }
  mesh.updateWorldMatrix(true, false)
  const positions = mesh.geometry.getAttribute('position')
  const uv = new Float32Array(positions.count * 2)
  const point = new THREE.Vector3()
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(surface.origin)
    uv[i * 2] = point.dot(surface.u) / surface.width
    uv[i * 2 + 1] = point.dot(surface.v) / surface.height
  }
  mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2))
  const texture = new THREE.DataTexture(
    new Uint16Array(source.width * source.height * 4), source.width, source.height,
    THREE.RGBAFormat, THREE.HalfFloatType,
  )
  texture.name = `Baked room indirect light: ${surfaceId}`
  texture.channel = 1
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  const state = { stage: source.stage, house: source.house, level: -1 }
  layers.set(texture, state)
  mixLightmap(texture, state, 0)
  mesh.material.lightMap = texture
}

export const applyRoomLightmapLevel = (room: THREE.Object3D, level: number) => {
  room.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)
      || !(object.material.lightMap instanceof THREE.DataTexture)) return
    const source = layers.get(object.material.lightMap)
    if (source) mixLightmap(object.material.lightMap, source, level)
  })
}
