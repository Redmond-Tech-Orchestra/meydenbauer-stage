import * as THREE from 'three'

export const roomHeight = 31
export const stageOffset = 2.25
export const roomOutline = [
  [-37, -80], [50, -80], [50, 80], [-50, 80],
  [-50, -60], [-40, -60], [-40, -63], [-37, -63],
]
export const stageTiers = [
  { width: 48, depth: 16, height: 6, z: -72 },
  { width: 48, depth: 8, height: 5, z: -60 },
  { width: 48, depth: 8, height: 4, z: -52 },
  { width: 54, depth: 8, height: 32 / 12, z: -44 },
]
export const fohBarCenters = [-18, 18]
export const stageWashTargets = [
  { x: -12, y: 4, z: -45.75 },
  { x: -12, y: 7, z: -65 },
  { x: 12, y: 7, z: -65 },
  { x: 12, y: 4, z: -45.75 },
]
export const ceilingZones = [
  ...[-74, -58, -44].map((z, index) => ({ name: `Stage row ${index + 1}`, z, stage: true })),
  ...[-24, 0, 24, 48, 72].map((z, index) => ({ name: `Audience row ${index + 1}`, z, stage: false })),
]
export const ceilingColumns = (stage: boolean) => stage ? [-18, 0, 18] : [-30, 0, 30]
export const fullHouseLightIntensity = 2400
export const stageCeilingMinimum = 600
export const createStageSpotlight = () =>
  new THREE.SpotLight(0xffe4bd, 3500, 125, THREE.MathUtils.degToRad(19), 0.65, 2)
export const createCeilingSpotlight = () =>
  new THREE.SpotLight(0xffefd7, 0, 65, THREE.MathUtils.degToRad(55), 0.8, 2)

export type RoomSurface = {
  id: string
  origin: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  normal: THREE.Vector3
  width: number
  height: number
  reflectance: THREE.Color
}

export const roomSurfaces: RoomSurface[] = [
  {
    id: 'floor', origin: new THREE.Vector3(-50, 0, -80),
    u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1),
    normal: new THREE.Vector3(0, 1, 0), width: 100, height: 160,
    reflectance: new THREE.Color(0xd9ddd7),
  },
  {
    id: 'ceiling', origin: new THREE.Vector3(-50, roomHeight, -80),
    u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1),
    normal: new THREE.Vector3(0, -1, 0), width: 100, height: 160,
    reflectance: new THREE.Color(0xe8ebe6),
  },
  ...roomOutline.map(([x, z], index) => {
    const [nextX, nextZ] = roomOutline[(index + 1) % roomOutline.length]
    const u = new THREE.Vector3(nextX - x, 0, nextZ - z)
    const width = u.length()
    u.normalize()
    return {
      id: `wall-${index}`, origin: new THREE.Vector3(x, 0, z),
      u, v: new THREE.Vector3(0, 1, 0),
      normal: new THREE.Vector3(-u.z, 0, u.x), width, height: roomHeight,
      reflectance: new THREE.Color(0xe8ebe6),
    }
  }),
]

export const roomWallAt = (x: number, z: number) => {
  const point = new THREE.Vector3(x, 0, z)
  const surface = roomSurfaces.find((candidate) => {
    if (!candidate.id.startsWith('wall-')) return false
    const offset = point.clone().sub(candidate.origin)
    const distance = offset.dot(candidate.u)
    return Math.abs(offset.dot(candidate.normal)) < 0.2
      && distance >= -0.2 && distance <= candidate.width + 0.2
  })
  if (!surface) throw new Error(`No room wall for (${x}, ${z}).`)
  return surface.id
}
