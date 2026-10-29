import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  ceilingColumns, ceilingZones, createCeilingSpotlight, createStageSpotlight,
  fohBarCenters, fullHouseLightIntensity, roomOutline, roomSurfaces,
  stageCeilingMinimum, stageOffset, stageTiers, stageWashTargets,
  type RoomSurface,
} from '../src/RoomLightingLayout.ts'

const spacing = 4
const bounces = 3
const surfaces = [...roomSurfaces]
const stageBoxes = stageTiers.map((tier) => new THREE.Box3(
  new THREE.Vector3(-tier.width / 2, 0, tier.z + stageOffset - tier.depth / 2),
  new THREE.Vector3(tier.width / 2, tier.height, tier.z + stageOffset + tier.depth / 2),
))
stageBoxes.forEach((box, index) => {
  const size = box.getSize(new THREE.Vector3())
  const makeSurface = (name: string, origin: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3,
    normal: THREE.Vector3, width: number, height: number) => {
    surfaces.push({
      id: `stage-${index}-${name}`, origin, u, v, normal, width, height,
      reflectance: new THREE.Color(0x343936),
    })
  }
  makeSurface('top', new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), size.x, size.z)
  ;[-1, 1].forEach((side) => {
    makeSurface(`side-${side}`, new THREE.Vector3(side * size.x / 2, 0, box.min.z),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(side, 0, 0), size.z, size.y)
    makeSurface(`end-${side}`, new THREE.Vector3(box.min.x, 0, side < 0 ? box.min.z : box.max.z),
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, side), size.x, size.y)
  })
})

type Patch = { position: THREE.Vector3; surface: RoomSurface; area: number }
const patches: Patch[] = []
const maps = surfaces.map((surface) => {
  const width = Math.ceil(surface.width / spacing)
  const height = Math.ceil(surface.height / spacing)
  const indices: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = surface.origin.clone()
        .addScaledVector(surface.u, (x + 0.5) * surface.width / width)
        .addScaledVector(surface.v, (y + 0.5) * surface.height / height)
      const visiblePosition = position.clone().addScaledVector(surface.normal, 0.03)
      let inside = false
      for (let i = 0, j = roomOutline.length - 1; i < roomOutline.length; j = i++) {
        const [xi, zi] = roomOutline[i]
        const [xj, zj] = roomOutline[j]
        if ((zi > visiblePosition.z) !== (zj > visiblePosition.z)
          && visiblePosition.x < (xj - xi) * (visiblePosition.z - zi) / (zj - zi) + xi) inside = !inside
      }
      if (!inside || stageBoxes.some((box) => box.containsPoint(visiblePosition))) {
        indices.push(-1)
        continue
      }
      indices.push(patches.length)
      patches.push({ position: visiblePosition, surface, area: surface.width * surface.height / (width * height) })
    }
  }
  return { id: surface.id, width, height, indices }
})

const ray = new THREE.Ray()
const hit = new THREE.Vector3()
const offset = new THREE.Vector3()
const direction = new THREE.Vector3()
const visible = (from: THREE.Vector3, to: THREE.Vector3) => {
  const distance = direction.subVectors(to, from).length()
  ray.set(from, direction.divideScalar(distance))
  if (stageBoxes.some((box) => ray.intersectBox(box, hit) && hit.distanceTo(from) < distance - 0.06)) return false
  for (const surface of roomSurfaces.slice(2)) {
    const denominator = ray.direction.dot(surface.normal)
    if (Math.abs(denominator) < 1e-8) continue
    const t = offset.subVectors(surface.origin, from).dot(surface.normal) / denominator
    if (t <= 0.06 || t >= distance - 0.06) continue
    ray.at(t, hit)
    offset.subVectors(hit, surface.origin)
    const u = offset.dot(surface.u)
    const v = offset.dot(surface.v)
    if (u >= 0 && u <= surface.width && v >= 0 && v <= surface.height) return false
  }
  return true
}

type Source = { light: THREE.SpotLight; position: THREE.Vector3; forward: THREE.Vector3; stage: number; house: number }
const sources: Source[] = []
fohBarCenters.forEach((centerX) => stageWashTargets.forEach((aim, index) => {
  const light = createStageSpotlight()
  const position = new THREE.Vector3(centerX + (index - 1.5) * 2.4, 25.8, -1.5)
  const forward = new THREE.Vector3(aim.x, aim.y, aim.z).sub(position).normalize()
  position.addScaledVector(forward, 0.42)
  sources.push({ light, position, forward, stage: light.intensity, house: 0 })
}))
ceilingZones.forEach((zone) => ceilingColumns(zone.stage).forEach((x) => {
  const position = new THREE.Vector3(x, 30.65, zone.z)
  sources.push({
    light: createCeilingSpotlight(), position,
    forward: new THREE.Vector3(x, zone.stage ? 6 : 0, zone.z).sub(position).normalize(),
    stage: zone.stage ? stageCeilingMinimum : 0,
    house: zone.stage ? fullHouseLightIntensity - stageCeilingMinimum : fullHouseLightIntensity,
  })
}))

const directStage = new Float64Array(patches.length * 3)
const directHouse = new Float64Array(patches.length * 3)
const delta = new THREE.Vector3()
patches.forEach((patch, index) => sources.forEach((source) => {
  const distance = delta.subVectors(source.position, patch.position).length()
  const incidence = Math.max(0, patch.surface.normal.dot(delta.divideScalar(distance)))
  const cone = THREE.MathUtils.smoothstep(
    -delta.dot(source.forward), Math.cos(source.light.angle),
    Math.cos(source.light.angle * (1 - source.light.penumbra)),
  )
  if (!incidence || !cone || !visible(patch.position, source.position)) return
  const cutoff = Math.pow(Math.max(0, 1 - Math.pow(distance / source.light.distance, 4)), 2)
  const factor = incidence * cone * cutoff / Math.max(distance * distance, 0.01)
  source.light.color.toArray().forEach((color, channel) => {
    directStage[index * 3 + channel] += color * source.stage * factor
    directHouse[index * 3 + channel] += color * source.house * factor
  })
}))

const count = patches.length
const transfer = new Float32Array(count * count)
for (let i = 0; i < count; i++) {
  for (let j = i + 1; j < count; j++) {
    const a = patches[i]
    const b = patches[j]
    const distanceSquared = delta.subVectors(b.position, a.position).lengthSq()
    delta.normalize()
    const cosines = Math.max(0, a.surface.normal.dot(delta)) * Math.max(0, -b.surface.normal.dot(delta))
    if (!cosines || !visible(a.position, b.position)) continue
    // Finite patch area softens the point-sample singularity at adjoining surfaces.
    const factor = cosines / (Math.PI * distanceSquared + Math.max(a.area, b.area))
    transfer[i * count + j] = factor * b.area
    transfer[j * count + i] = factor * a.area
  }
  let sum = 0
  for (let j = 0; j < count; j++) sum += transfer[i * count + j]
  if (sum > 1) for (let j = 0; j < count; j++) transfer[i * count + j] /= sum
}

const solve = (direct: Float64Array) => {
  // Only reflected irradiance goes into the maps; live lights provide the direct term.
  let outgoing = direct.slice()
  const indirect = new Float64Array(count * 3)
  const peaks = [Math.max(...direct)]
  for (let bounce = 0; bounce < bounces; bounce++) {
    patches.forEach((patch, i) => patch.surface.reflectance.toArray().forEach((color, channel) => {
      outgoing[i * 3 + channel] *= color
    }))
    const next = new Float64Array(count * 3)
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const weight = transfer[i * count + j]
        if (!weight) continue
        for (let channel = 0; channel < 3; channel++) next[i * 3 + channel] += weight * outgoing[j * 3 + channel]
      }
    }
    next.forEach((value, i) => { indirect[i] += value })
    peaks.push(Math.max(...next))
    outgoing = next
  }
  return { indirect, peaks }
}
const stage = solve(directStage)
const house = solve(directHouse)
const baked = maps.filter((map) => !map.id.startsWith('stage-')).map((map) => {
  const samples = (values: Float64Array) => map.indices.flatMap((index) =>
    [0, 1, 2].map((channel) => index < 0 ? 0 : Number(values[index * 3 + channel].toFixed(6))))
  return {
    id: map.id, width: map.width, height: map.height,
    stage: samples(stage.indirect), house: samples(house.indirect),
  }
})
if (baked.some((map) => [...map.stage, ...map.house].some((value) => !Number.isFinite(value) || value < 0))) {
  throw new Error('Invalid baked irradiance.')
}
if (baked.some((map) => !map.house.some((value) => value > 0) || !map.stage.some((value) => value > 0))) {
  throw new Error('A room surface has no baked lighting contribution.')
}
const output = JSON.stringify({
  bounces, spacing, bouncePeaks: { stage: stage.peaks, house: house.peaks }, surfaces: baked,
}) + '\n'
const destination = new URL('../src/room-lighting-bake.json', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) {
    throw new Error('Room lighting bake is stale. Run npm run bake:lighting.')
  }
} else {
  writeFileSync(destination, output)
}
sources.forEach(({ light }) => light.dispose())
console.log(`Baked ${bounces} diffuse bounces over ${count} patches into ${baked.length} room lightmaps (stage + house).`)
