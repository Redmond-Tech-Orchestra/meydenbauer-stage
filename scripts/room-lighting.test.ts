import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import bake from '../src/room-lighting-bake.json' with { type: 'json' }
import { applyRoomLightmapLevel, attachRoomLightmap } from '../src/RoomLighting.ts'
import { roomHeight, roomSurfaces, roomWallAt } from '../src/RoomLightingLayout.ts'

test('bake has three bounces and nonuniform, nonnegative layers for every room surface', () => {
  assert.equal(bake.bounces, 3)
  assert.equal(bake.spacing, 4)
  for (const peaks of Object.values(bake.bouncePeaks)) {
    assert.equal(peaks.length, 4, 'Direct light plus three calculated bounces.')
    peaks.forEach((value, index) => {
      assert.ok(Number.isFinite(value) && value > 0)
      if (index > 0) assert.ok(value < peaks[index - 1], 'Successive bounces lose energy.')
    })
  }
  assert.deepEqual(bake.surfaces.map((surface) => surface.id), roomSurfaces.map((surface) => surface.id))
  for (const surface of bake.surfaces) {
    for (const values of [surface.stage, surface.house]) {
      assert.equal(values.length, surface.width * surface.height * 3)
      assert.ok(values.every((value) => Number.isFinite(value) && value >= 0))
      assert.ok(Math.max(...values) > Math.min(...values))
      assert.ok(Math.max(...values) < 65504, 'Irradiance fits a half-float texture.')
    }
  }
})

test('persisted bake is reproducible and matches the current static layout and lights', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('./bake-room-lighting.ts', import.meta.url)), '--check'])
})

test('lightmaps preserve the stage baseline and mix house lighting linearly without reallocating', () => {
  const material = new THREE.MeshStandardMaterial()
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 160), material)
  mesh.rotation.x = -Math.PI / 2
  attachRoomLightmap(mesh, 'floor')
  const texture = material.lightMap
  assert.ok(texture instanceof THREE.DataTexture)
  const data = texture.image.data
  assert.ok(data instanceof Uint16Array)
  const source = bake.surfaces.find((surface) => surface.id === 'floor')
  assert.ok(source)
  const uv = mesh.geometry.getAttribute('uv1')
  assert.equal(uv.count, mesh.geometry.getAttribute('position').count)
  assert.equal(texture.channel, 1)
  assert.equal(texture.colorSpace, THREE.LinearSRGBColorSpace)
  for (const level of [0, 15, 50, 100, 0]) {
    applyRoomLightmapLevel(mesh, level)
    assert.equal(material.lightMap, texture)
    assert.equal(texture.image.data, data)
    for (let i = 0; i < source.stage.length; i++) {
      assert.equal(data[Math.floor(i / 3) * 4 + i % 3],
        THREE.DataUtils.toHalfFloat(source.stage[i] + source.house[i] * level / 100))
    }
    const version: number = texture.version
    applyRoomLightmapLevel(mesh, level)
    assert.equal(texture.version, version, 'Unchanged dimmer levels do not reupload the lightmap.')
  }
  texture.dispose()
  mesh.geometry.dispose()
  material.dispose()
})

test('room projections include the cutout, doors, and downward-facing ceiling', () => {
  assert.equal(roomWallAt(-50, -46), 'wall-3')
  assert.equal(roomWallAt(-44, -60), 'wall-4')
  assert.equal(roomWallAt(-38.5, -63), 'wall-6')
  assert.equal(roomWallAt(13, 80), 'wall-2')
  const ceiling = roomSurfaces.find((surface) => surface.id === 'ceiling')
  assert.ok(ceiling)
  assert.equal(ceiling.origin.y, roomHeight)
  assert.equal(ceiling.normal.y, -1)
  assert.throws(() => roomWallAt(0, 0), /No room wall/)
})
