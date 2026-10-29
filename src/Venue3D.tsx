import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import SceneSelector, { type StageScene } from './StageScenes'
import { applyRoomLightmapLevel, attachRoomLightmap } from './RoomLighting'
import {
  ceilingColumns, ceilingZones, createCeilingSpotlight, createStageSpotlight, fohBarCenters,
  fullHouseLightIntensity, roomHeight, roomOutline, roomWallAt, stageCeilingMinimum,
  stageOffset, stageTiers, stageWashTargets,
} from './RoomLightingLayout'

export type VenueSeatKind = 'regular' | 'wheelchair' | 'companion'
export type VenueSeatCategory = 'premium' | 'reserved' | 'general' | 'accessible'

export type VenueSeat = {
  id: string
  zone: 'Front' | 'Middle' | 'Rear'
  position: 'Left' | 'Center' | 'Right'
  row: number
  column: number
  columns: number
  span: 1 | 2
  kind: VenueSeatKind
  category: VenueSeatCategory
  occupied: boolean
}

type Venue3DProps = {
  seats: VenueSeat[]
  audienceTotal: number
  totalCapacity: number
  stageScene: StageScene
  onSceneChange: (scene: StageScene) => void
  controlsHost: HTMLDivElement | null
}

// Overlapping interior boxes follow the stepped wall cutout, inset by six inches.
const cameraRoomBounds = [
  new THREE.Box3(new THREE.Vector3(-36.5, 0.5, -79.5), new THREE.Vector3(49.5, roomHeight - 0.5, 79.5)),
  new THREE.Box3(new THREE.Vector3(-39.5, 0.5, -62.5), new THREE.Vector3(49.5, roomHeight - 0.5, 79.5)),
  new THREE.Box3(new THREE.Vector3(-49.5, 0.5, -59.5), new THREE.Vector3(49.5, roomHeight - 0.5, 79.5)),
]
const constrainCameraPosition = (position: THREE.Vector3) => {
  if (cameraRoomBounds.some((bounds) => bounds.containsPoint(position))) return
  const candidate = new THREE.Vector3()
  const nearest = new THREE.Vector3()
  let nearestDistance = Infinity
  for (const bounds of cameraRoomBounds) {
    bounds.clampPoint(position, candidate)
    const distance = candidate.distanceToSquared(position)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest.copy(candidate)
    }
  }
  position.copy(nearest)
}
const seatPitch = 1.53
const rowPitch = 3.25
const sideRowAngle = THREE.MathUtils.degToRad(15)
const videoAspect = 16 / 9
const cameraViewportFov = (focalLength: number, viewportAspect: number) => {
  const frameHeightFraction = Math.min(1, viewportAspect / videoAspect)
  return THREE.MathUtils.radToDeg(2 * Math.atan((36 / videoAspect / (2 * focalLength)) / frameHeightFraction))
}

const aimCamera = (
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  deltaX: number,
  deltaY: number,
  viewportHeight: number,
) => {
  const distance = camera.position.distanceTo(target)
  const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  const sensitivity = Math.PI / Math.max(viewportHeight, 1)
  rotation.y -= deltaX * sensitivity
  rotation.x = THREE.MathUtils.clamp(rotation.x - deltaY * sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
  camera.quaternion.setFromEuler(rotation)
  target.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(distance).add(camera.position)
}

const zoneStart: Record<VenueSeat['zone'], number> = {
  Front: -26.85,
  Middle: 2.36,
  Rear: 31.57,
}

const categoryColors: Record<Exclude<VenueSeatCategory, 'accessible'>, number> = {
  premium: 0xd2a33f,
  reserved: 0x7e8782,
  general: 0x4f86aa,
}

const orchestraColors: Record<string, number> = {
  'First violins': 0x8062a8,
  'Second violins': 0x9c80bf,
  Violas: 0x71548c,
  Cellos: 0xb09acb,
  Basses: 0x57416f,
  Harps: 0x8b70ad,
  Flutes: 0x93b991,
  Oboes: 0x668f63,
  Clarinets: 0x789e77,
  Bassoons: 0x466b48,
  Horns: 0xb99b3e,
  Trumpets: 0xe2c65e,
  Trombones: 0xc8ad4d,
  Tuba: 0xf0db87,
}

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (child instanceof THREE.SpotLight) child.dispose()
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        if ((material instanceof THREE.MeshBasicMaterial
          || material instanceof THREE.MeshStandardMaterial) && material.map) {
          material.map.dispose()
        }
        if (material instanceof THREE.MeshStandardMaterial) material.lightMap?.dispose()
        material.dispose()
      })
    }
    if (child instanceof THREE.Sprite) {
      if (child.material.map) child.material.map.dispose()
      child.material.dispose()
    }
  })
}

const createWheelchairTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the wheelchair marker texture.')

  context.fillStyle = '#27708c'
  context.roundRect(4, 4, 120, 120, 16)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = '86px Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('♿', 64, 67)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const createStage = (scene: StageScene = 'barber') => {
  const stage = new THREE.Group()
  stage.name = 'Tiered stage with orchestra seating'
  const tiers = stageTiers

  tiers.forEach((tier) => {
    const geometry = new THREE.BoxGeometry(tier.width, tier.height, tier.depth)
    const material = new THREE.MeshStandardMaterial({
      color: 0x343936,
      roughness: 0.88,
    })
    const platform = new THREE.Mesh(geometry, material)
    platform.position.set(0, tier.height / 2, tier.z)
    platform.receiveShadow = true
    platform.castShadow = true
    stage.add(platform)
  })

  const stairMaterial = new THREE.MeshStandardMaterial({ color: 0x68776a, roughness: 0.88 })
  const stairTreadDepth = 11 / 12
  const addStageStairs = (deckHeight: number, z: number, width = 3, edgeX = 24, side: 1 | -1 = 1) => {
    const stairs = new THREE.Group()
    const heightLabel = deckHeight === 32 / 12 ? '2 ft 8 in' : `${deckHeight}-foot`
    stairs.name = `Stage-${side === 1 ? 'left' : 'right'} stairs to ${heightLabel} tier (schematic)`
    stairs.position.set(side * edgeX, 0, z)
    const stairCount = Math.ceil(deckHeight / 0.5)
    stairs.userData.stairCount = stairCount
    for (let index = 0; index < stairCount; index++) {
      const height = deckHeight * (stairCount - index) / stairCount
      const step = new THREE.Mesh(new THREE.BoxGeometry(stairTreadDepth, height, width), stairMaterial)
      step.position.set(side * (index + 0.5) * stairTreadDepth, height / 2, 0)
      step.castShadow = true
      step.receiveShadow = true
      stairs.add(step)
    }
    stage.add(stairs)
  }
  addStageStairs(5, -60)
  addStageStairs(6, -76)
  addStageStairs(32 / 12, -44, 2, 27, 1)
  addStageStairs(32 / 12, -44, 2, 27, -1)

  const railingMaterial = new THREE.MeshStandardMaterial({
    color: 0x242827,
    metalness: 0.65,
    roughness: 0.4,
  })
  const addRailing = (
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    stageHeight: number,
  ) => {
    const length = Math.hypot(endX - startX, endZ - startZ)
    const postCount = Math.ceil(length / 4)
    for (let index = 0; index <= postCount; index++) {
      const fraction = index / postCount
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.5, 0.12), railingMaterial)
      post.name = 'Stage railing post'
      post.position.set(
        startX + (endX - startX) * fraction,
        stageHeight + 1.75,
        startZ + (endZ - startZ) * fraction,
      )
      post.castShadow = true
      stage.add(post)
    }
    ;[1.75, 3.5].forEach((height) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 0.1), railingMaterial)
      rail.name = 'Stage railing'
      rail.position.set((startX + endX) / 2, stageHeight + height, (startZ + endZ) / 2)
      rail.rotation.y = -Math.atan2(endZ - startZ, endX - startX)
      rail.castShadow = true
      stage.add(rail)
    })
  }
  tiers.forEach((tier) => {
    if (tier.height === 32 / 12) return
    ;[-1, 1].forEach((side) => {
      const x = side * (tier.width / 2 - 0.12)
      if (side === 1 && tier.height === 5) {
        addRailing(x, -64, x, -61.5, tier.height)
        addRailing(x, -58.5, x, -56, tier.height)
      } else if (side === 1 && tier.height === 6) {
        addRailing(x, -80, x, -77.5, tier.height)
        addRailing(x, -74.5, x, -64, tier.height)
      } else {
        addRailing(x, tier.z - tier.depth / 2, x, tier.z + tier.depth / 2, tier.height)
      }
    })
  })
  addRailing(-23.88, -79.88, 23.88, -79.88, 6)

  const conductorPosition = new THREE.Vector3(0, 32 / 12, -44)
  const podiumMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })
  const podiumBaseWidth = 1 / 0.3048
  const podiumBaseHeight = 10.8 / 12
  const podiumTopWidth = 30 / 12
  const podiumTopHeight = 8 / 12
  const podiumBase = new THREE.Mesh(
    new THREE.BoxGeometry(podiumBaseWidth, podiumBaseHeight, podiumBaseWidth),
    podiumMaterial,
  )
  podiumBase.name = 'Conductor podium base: 1 meter square, 10.8 inches tall'
  podiumBase.position.set(0, conductorPosition.y + podiumBaseHeight / 2, conductorPosition.z)
  const podiumTop = new THREE.Mesh(
    new THREE.BoxGeometry(podiumTopWidth, podiumTopHeight, podiumTopWidth),
    podiumMaterial,
  )
  podiumTop.name = 'Conductor podium upper layer: 30 inches square, 8 inches tall'
  podiumTop.position.set(
    0,
    conductorPosition.y + podiumBaseHeight + podiumTopHeight / 2,
    conductorPosition.z,
  )
  ;[podiumBase, podiumTop].forEach((layer) => {
    layer.receiveShadow = true
    layer.castShadow = true
    stage.add(layer)
  })

  const mannequin = new THREE.Group()
  mannequin.name = 'Conductor mannequin: 5 feet 5 inches plus 1-inch soles'
  const bodyHeight = 65 / 12
  const soleHeight = 1 / 12
  const legHeight = 2.65
  const torsoHeight = 1.85
  const neckHeight = 0.15
  const headHeight = bodyHeight - legHeight - torsoHeight - neckHeight
  const mannequinMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4b49a,
    roughness: 0.78,
  })
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.8 })
  ;[-0.24, 0.24].forEach((x) => {
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.32, soleHeight, 0.75), shoeMaterial)
    sole.position.set(x, soleHeight / 2, -0.13)
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.11, legHeight, 12),
      mannequinMaterial,
    )
    leg.position.set(x, soleHeight + legHeight / 2, 0)
    mannequin.add(sole, leg)
  })
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.36, torsoHeight, 16),
    mannequinMaterial,
  )
  torso.scale.z = 0.6
  torso.position.y = soleHeight + legHeight + torsoHeight / 2
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, neckHeight, 12),
    mannequinMaterial,
  )
  neck.position.y = soleHeight + legHeight + torsoHeight + neckHeight / 2
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), mannequinMaterial)
  head.scale.set(0.29, headHeight / 2, 0.31)
  head.position.y = soleHeight + bodyHeight - headHeight / 2
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mannequinMaterial)
  nose.position.set(0, head.position.y - 0.04, -0.31)
  mannequin.add(torso, neck, head, nose)
  ;[-0.62, 0.62].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 1.55, 4, 10), mannequinMaterial)
    arm.position.set(x, soleHeight + legHeight + torsoHeight - 0.92, 0)
    mannequin.add(arm)
  })
  mannequin.position.set(
    conductorPosition.x,
    conductorPosition.y + podiumBaseHeight + podiumTopHeight,
    conductorPosition.z,
  )
  mannequin.traverse((part) => {
    if (part instanceof THREE.Mesh) part.castShadow = true
  })
  stage.add(mannequin)

  const soloistPosition = new THREE.Vector3(-4.25, 32 / 12, -43.3)
  if (scene === 'barber') {
    const soloist = mannequin.clone()
    soloist.name = 'Violin soloist'
    soloist.position.copy(soloistPosition)
    soloist.rotation.y = Math.PI
    soloist.remove(...soloist.children.slice(-2))
    const addLimb = (start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material) => {
      const direction = end.clone().sub(start)
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), material)
      mesh.position.copy(start).add(end).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      soloist.add(mesh)
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x9b491e, roughness: 0.45 })
    const fingerboard = new THREE.MeshStandardMaterial({ color: 0x28201b, roughness: 0.6 })
    const violin = new THREE.Group()
    violin.name = 'Violin in playing position'
    ;[0, 0.48].forEach((x, index) => {
      const bout = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), wood)
      bout.scale.set(index === 0 ? 0.36 : 0.28, 0.09, index === 0 ? 0.27 : 0.23)
      bout.position.x = x
      violin.add(bout)
    })
    const violinNeck = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.13), fingerboard)
    violinNeck.position.set(1.08, 0.06, 0)
    violin.add(violinNeck)
    violin.position.set(-0.2, 4.65, -0.36)
    violin.rotation.y = Math.PI + Math.atan2(
      soloistPosition.z - conductorPosition.z,
      conductorPosition.x - soloistPosition.x,
    )
    soloist.add(violin)
    addLimb(new THREE.Vector3(-0.45, 4.45, 0), new THREE.Vector3(-0.85, 3.95, -0.3), 0.1, mannequinMaterial)
    addLimb(new THREE.Vector3(-0.85, 3.95, -0.3), new THREE.Vector3(-1.1, 4.65, -0.2), 0.09, mannequinMaterial)
    addLimb(new THREE.Vector3(0.45, 4.45, 0), new THREE.Vector3(0.9, 4.05, -0.35), 0.1, mannequinMaterial)
    addLimb(new THREE.Vector3(0.9, 4.05, -0.35), new THREE.Vector3(0.35, 4.72, -0.95), 0.09, mannequinMaterial)
    soloist.traverse((part) => {
      if (part instanceof THREE.Mesh) part.castShadow = true
    })
    stage.add(soloist)
  }

  const chairSeatGeometry = new THREE.BoxGeometry(1.45, 0.25, 1.4)
  const chairBackGeometry = new THREE.BoxGeometry(1.45, 1.45, 0.2)
  const chairLegGeometry = new THREE.BoxGeometry(0.12, 1.3, 0.12)
  const stoolSeatGeometry = new THREE.CylinderGeometry(0.78, 0.78, 0.24, 20)
  const stoolLegGeometry = new THREE.CylinderGeometry(0.07, 0.07, 2.05, 8)
  const stoolFootrestGeometry = new THREE.TorusGeometry(0.57, 0.055, 6, 20)
  const chairFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0x202522,
    metalness: 0.35,
    roughness: 0.58,
  })
  const sectionMaterials = new Map<string, THREE.MeshStandardMaterial>()

  const addChair = (
    section: string,
    color: number,
    x: number,
    stageHeight: number,
    z: number,
    faceConductor = true,
    fixedYaw?: number,
  ) => {
    let upholstery = sectionMaterials.get(section)
    if (!upholstery) {
      upholstery = new THREE.MeshStandardMaterial({
        color: orchestraColors[section] ?? color,
        roughness: 0.82,
      })
      sectionMaterials.set(section, upholstery)
    }

    const chair = new THREE.Group()
    chair.name = section
    const seat = new THREE.Mesh(chairSeatGeometry, upholstery)
    seat.position.y = 1.42
    seat.castShadow = true
    const back = new THREE.Mesh(chairBackGeometry, upholstery)
    back.position.set(0, 2.08, 0.62)
    back.castShadow = true
    chair.add(seat, back)

    ;[-0.52, 0.52].forEach((legX) => {
      ;[-0.47, 0.47].forEach((legZ) => {
        const leg = new THREE.Mesh(chairLegGeometry, chairFrameMaterial)
        leg.position.set(legX, 0.65, legZ)
        leg.castShadow = true
        chair.add(leg)
      })
    })

    chair.position.set(x, stageHeight, z)
    if (fixedYaw !== undefined) {
      chair.rotation.y = fixedYaw
    } else if (faceConductor) {
      const directionX = conductorPosition.x - chair.position.x
      const directionZ = conductorPosition.z - chair.position.z
      chair.rotation.y = Math.atan2(-directionX, -directionZ)
    } else {
      chair.rotation.y = Math.PI
    }
    stage.add(chair)
  }

  const addStool = (
    x: number,
    stageHeight: number,
    z: number,
  ) => {
    let upholstery = sectionMaterials.get('Basses')
    if (!upholstery) {
      upholstery = new THREE.MeshStandardMaterial({ color: orchestraColors.Basses, roughness: 0.82 })
      sectionMaterials.set('Basses', upholstery)
    }

    const stool = new THREE.Group()
    stool.name = 'Basses'
    const seat = new THREE.Mesh(stoolSeatGeometry, upholstery)
    seat.position.y = 2.12
    seat.castShadow = true
    stool.add(seat)

    ;[-0.43, 0.43].forEach((legX) => {
      ;[-0.43, 0.43].forEach((legZ) => {
        const leg = new THREE.Mesh(stoolLegGeometry, chairFrameMaterial)
        leg.position.set(legX, 1.03, legZ)
        leg.castShadow = true
        stool.add(leg)
      })
    })

    const footrest = new THREE.Mesh(stoolFootrestGeometry, chairFrameMaterial)
    footrest.position.y = 0.82
    footrest.rotation.x = Math.PI / 2
    stool.add(footrest)

    stool.position.set(x, stageHeight, z)
    stage.add(stool)
  }

  const addKeyboard = (
    name: string,
    width: number,
    depth: number,
    height: number,
    x: number,
    z: number,
    color: number,
    stageHeight = 5,
    yaw = 0,
  ) => {
    const keyboard = new THREE.Group()
    keyboard.name = name
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.68 })
    const keyMaterial = new THREE.MeshStandardMaterial({ color: 0xf1eee4, roughness: 0.72 })
    const blackKeyMaterial = new THREE.MeshStandardMaterial({ color: 0x121514, roughness: 0.55 })

    const bodyY = 2.28
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial)
    body.position.y = bodyY
    body.castShadow = true
    keyboard.add(body)

    const keyBedDepth = depth * 0.58
    const keyBedZ = -depth * 0.09
    const blackKeyDepth = depth * 0.32
    const keyBed = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.05, keyBedDepth),
      keyMaterial,
    )
    keyBed.position.set(0, bodyY + height / 2 + 0.035, keyBedZ)
    keyboard.add(keyBed)

    const blackKeyCount = name.includes('88') ? 18 : 10
    for (let index = 0; index < blackKeyCount; index += 1) {
      const key = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.018, 0.07, blackKeyDepth),
        blackKeyMaterial,
      )
      key.position.set(
        -width * 0.41 + (index + 0.5) * (width * 0.82 / blackKeyCount),
        bodyY + height / 2 + 0.085,
        keyBedZ + (keyBedDepth - blackKeyDepth) / 2,
      )
      keyboard.add(key)
    }

    ;[-1, 1].forEach((direction) => {
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.15, 0.12),
        chairFrameMaterial,
      )
      stand.position.y = 1.08
      stand.rotation.z = direction * 0.32
      stand.castShadow = true
      keyboard.add(stand)
    })

    const benchSeat = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.18, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x252827, roughness: 0.78 }),
    )
    benchSeat.position.set(0, 1.55, -1.3)
    benchSeat.castShadow = true
    keyboard.add(benchSeat)
    ;[-0.7, 0.7].forEach((benchX) => {
      ;[-1.58, -1.02].forEach((benchZ) => {
        const benchLeg = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 1.46, 0.1),
          chairFrameMaterial,
        )
        benchLeg.position.set(benchX, 0.76, benchZ)
        keyboard.add(benchLeg)
      })
    })

    keyboard.position.set(x, stageHeight, z)
    keyboard.rotation.y = yaw
    stage.add(keyboard)
  }

  const addHarp = (x: number, z: number) => {
    const harp = new THREE.Group()
    harp.name = 'Concert harp'
    harp.userData.orchestraSection = 'Harps'
    const height = 74 / 12
    const width = 39.5 / 12
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x9c6d32,
      metalness: 0.08,
      roughness: 0.65,
    })
    const stringMaterial = new THREE.LineBasicMaterial({
      color: 0xd9bf78,
      opacity: 0.92,
      transparent: true,
    })
    const beamGeometry = (length: number, radius: number) =>
      new THREE.CylinderGeometry(radius, radius, length, 10)
    const addBeam = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
      const direction = end.clone().sub(start)
      const beam = new THREE.Mesh(beamGeometry(direction.length(), radius), frameMaterial)
      beam.position.copy(start).add(end).multiplyScalar(0.5)
      beam.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      )
      beam.castShadow = true
      harp.add(beam)
    }

    const baseLeft = new THREE.Vector3(-width / 2, 0.28, 0)
    const baseRight = new THREE.Vector3(width / 2, 0.28, 0)
    const shoulder = new THREE.Vector3(-width * 0.33, height * 0.83, 0)
    const crown = new THREE.Vector3(width / 2, height, 0)
    addBeam(baseLeft, shoulder, 0.25)
    addBeam(shoulder, crown, 0.14)
    addBeam(baseRight, crown, 0.14)
    addBeam(baseLeft, baseRight, 0.18)

    const stringPoints: THREE.Vector3[] = []
    for (let index = 1; index <= 14; index += 1) {
      const progress = index / 15
      const stringX = THREE.MathUtils.lerp(shoulder.x, crown.x, progress)
      const topY = THREE.MathUtils.lerp(shoulder.y, crown.y, progress)
      stringPoints.push(
        new THREE.Vector3(stringX, baseLeft.y, 0),
        new THREE.Vector3(stringX, topY, 0),
      )
    }
    harp.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(stringPoints),
      stringMaterial,
    ))

    harp.position.set(x, 5, z)
    harp.rotation.y = Math.atan2(
      z - conductorPosition.z,
      conductorPosition.x - x,
    )
    stage.add(harp)
    // Sit behind the short side, with the instrument on the harpist's right.
    const chairPosition = new THREE.Vector3(-width / 2 - 1.1, 0, -0.65)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), harp.rotation.y)
      .add(harp.position)
    addChair(
      'Harps',
      orchestraColors.Harps,
      chairPosition.x,
      chairPosition.y,
      chairPosition.z,
      false,
      harp.rotation.y - Math.PI / 2,
    )
  }

  const addTimpani = (diameterInches: number, x: number, z: number, section: string, yaw = 0) => {
    const radius = diameterInches / 24
    const timpano = new THREE.Group()
    timpano.name = `${diameterInches}-inch timpano`
    timpano.userData.orchestraSection = section
    const copperMaterial = new THREE.MeshStandardMaterial({
      color: 0xa65b32,
      metalness: 0.65,
      roughness: 0.3,
    })
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5d5ad,
      roughness: 0.82,
    })
    const hardwareMaterial = new THREE.MeshStandardMaterial({
      color: 0x252a28,
      metalness: 0.55,
      roughness: 0.42,
    })

    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.53, 1.28, 24, 1, true),
      copperMaterial,
    )
    bowl.position.y = 1.8
    bowl.castShadow = true
    timpano.add(bowl)

    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.08, 24),
      headMaterial,
    )
    head.position.y = 2.48
    head.castShadow = true
    timpano.add(head)

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.07, 8, 24),
      hardwareMaterial,
    )
    rim.position.y = 2.53
    rim.rotation.x = Math.PI / 2
    timpano.add(rim)

    ;[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].forEach((angle) => {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 1.55, 8),
        hardwareMaterial,
      )
      leg.position.set(Math.cos(angle) * radius * 0.52, 0.78, Math.sin(angle) * radius * 0.52)
      leg.castShadow = true
      timpano.add(leg)
    })

    const pedal = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.1, 0.62),
      hardwareMaterial,
    )
    pedal.position.set(0, 0.12, radius * 0.78)
    pedal.rotation.x = -0.12
    timpano.add(pedal)

    timpano.position.set(x, 6, z)
    timpano.rotation.y = yaw
    stage.add(timpano)
  }

  const percussionFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0x252a28,
    metalness: 0.58,
    roughness: 0.4,
  })
  const percussionHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5d5ad,
    roughness: 0.82,
  })
  const percussionMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0xb88a36,
    metalness: 0.72,
    roughness: 0.3,
  })

  const addConcertBassDrum = (x: number, z: number) => {
    const drum = new THREE.Group()
    drum.name = 'Yamaha 7000 concert bass drum'
    const radius = 32 / 24
    const depth = 16 / 12
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, depth, 28),
      new THREE.MeshStandardMaterial({ color: 0x30393d, roughness: 0.58 }),
    )
    shell.rotation.z = Math.PI / 2
    shell.position.y = 2.25
    shell.castShadow = true
    drum.add(shell)

    ;[-depth / 2 - 0.045, depth / 2 + 0.045].forEach((drumX) => {
      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.07, 28),
        percussionHeadMaterial,
      )
      head.rotation.z = Math.PI / 2
      head.position.set(drumX, 2.25, 0)
      drum.add(head)
    })

    ;[-0.85, 0.85].forEach((standX) => {
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 2.1, 0.11),
        percussionFrameMaterial,
      )
      stand.position.set(standX, 1.05, 0)
      stand.castShadow = true
      drum.add(stand)
    })
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.12, 1.9),
      percussionFrameMaterial,
    )
    base.position.y = 0.08
    drum.add(base)
    drum.position.set(x, 6, z)
    stage.add(drum)
  }

  const addSnareDrum = (x: number, z: number, name = 'Snare drum') => {
    const snare = new THREE.Group()
    snare.name = name
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(7 / 12, 7 / 12, 6.5 / 12, 20),
      new THREE.MeshStandardMaterial({
        color: 0x8f3e35,
        metalness: 0.25,
        roughness: 0.48,
      }),
    )
    shell.position.y = 2.55
    shell.castShadow = true
    snare.add(shell)
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(7 / 12, 7 / 12, 0.05, 20),
      percussionHeadMaterial,
    )
    head.position.y = 2.85
    snare.add(head)
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 2.3, 8),
      percussionFrameMaterial,
    )
    stand.position.y = 1.2
    snare.add(stand)
    snare.position.set(x, 6, z)
    stage.add(snare)
  }

  const addCymbalStand = (name: 'Suspended cymbal' | 'Hi-hat', x: number, z: number) => {
    const cymbal = new THREE.Group()
    cymbal.name = name
    const isHiHat = name === 'Hi-hat'
    const standHeight = isHiHat ? 2.9 : 3.9
    ;(isHiHat ? [3, 3.12] : [4.05]).forEach((height) => {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry((isHiHat ? 7 : 10) / 12, (isHiHat ? 7 : 10) / 12, 0.045, 28),
        percussionMetalMaterial,
      )
      disc.position.y = height
      disc.rotation.z = isHiHat ? 0 : 0.1
      disc.castShadow = true
      cymbal.add(disc)
    })
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.055, standHeight, 8),
      percussionFrameMaterial,
    )
    stand.position.y = standHeight / 2
    cymbal.add(stand)
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 0.07, 3),
      percussionFrameMaterial,
    )
    foot.position.y = 0.06
    cymbal.add(foot)
    if (isHiHat) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.65), percussionFrameMaterial)
      pedal.position.set(0, 0.1, 0.4)
      cymbal.add(pedal)
    }
    cymbal.position.set(x, 6, z)
    stage.add(cymbal)
  }

  const addTamTam = (x: number, z: number) => {
    const tamTam = new THREE.Group()
    tamTam.name = '20-inch tam-tam'
    const gong = new THREE.Mesh(
      new THREE.CylinderGeometry(20 / 24, 20 / 24, 0.06, 32),
      percussionMetalMaterial,
    )
    gong.rotation.x = Math.PI / 2
    gong.position.y = 3.5
    gong.castShadow = true
    tamTam.add(gong)
    ;[-1, 1].forEach((side) => {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.6, 0.08), percussionFrameMaterial)
      upright.position.set(side, 2.3, 0)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 1.1), percussionFrameMaterial)
      foot.position.set(side, 0.05, 0)
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 6), percussionFrameMaterial)
      cord.position.set(side * 0.3, 4.32, 0)
      tamTam.add(upright, foot, cord)
    })
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.08), percussionFrameMaterial)
    crossbar.position.y = 4.6
    tamTam.add(crossbar)
    tamTam.position.set(x, 6, z)
    stage.add(tamTam)
  }

  const addCrashCymbals = (x: number, z: number) => {
    const cymbals = new THREE.Group()
    cymbals.name = 'Crash cymbals on stand'
    ;[-0.46, 0.46].forEach((offsetX) => {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(9 / 12, 9 / 12, 0.045, 28),
        percussionMetalMaterial,
      )
      disc.rotation.z = Math.PI / 2
      disc.position.set(offsetX, 3.3, 0)
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.1), percussionFrameMaterial)
      strap.position.set(offsetX, 3.3, 0)
      cymbals.add(disc, strap)
    })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.3, 8), percussionFrameMaterial)
    pole.position.y = 1.65
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), percussionFrameMaterial)
    rack.position.y = 3.3
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 3), percussionFrameMaterial)
    foot.position.y = 0.04
    cymbals.add(pole, rack, foot)
    cymbals.position.set(x, 6, z)
    stage.add(cymbals)
  }

  const addCongas = (x: number, z: number) => {
    const congas = new THREE.Group()
    congas.name = 'Congas'
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x9e552c, roughness: 0.55 })
    ;[-0.7, 0.7].forEach((offsetX, index) => {
      const radius = (index === 0 ? 11 : 12) / 24
      const shell = new THREE.Mesh(
        new THREE.LatheGeometry([
          new THREE.Vector2(radius * 0.62, 0.15),
          new THREE.Vector2(radius * 0.95, 1.1),
          new THREE.Vector2(radius * 1.08, 1.9),
          new THREE.Vector2(radius, 2.5),
        ], 24),
        shellMaterial,
      )
      shell.position.x = offsetX
      shell.castShadow = true
      const head = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.07, 24), percussionHeadMaterial)
      head.position.set(offsetX, 2.5, 0)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 24), percussionFrameMaterial)
      rim.rotation.x = Math.PI / 2
      rim.position.set(offsetX, 2.5, 0)
      congas.add(shell, head, rim)
    })
    congas.position.set(x, 6, z)
    stage.add(congas)
  }

  const addTomSet = (x: number, z: number) => {
    const toms = new THREE.Group()
    toms.name = 'Three concert toms'
    ;[10, 12, 14].forEach((diameter, index) => {
      const radius = diameter / 24
      const centerDistance = radius + 12 / 24 + 0.08
      const offsetX = index === 1 ? 0 : (index - 1) * centerDistance * Math.cos(Math.PI / 4)
      const offsetZ = index === 1 ? 0 : -centerDistance * Math.sin(Math.PI / 4)
      const tom = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 0.72, 18),
        new THREE.MeshStandardMaterial({ color: 0x455f69, roughness: 0.52 }),
      )
      tom.position.set(offsetX, 2.75 - index * 0.08, offsetZ)
      tom.castShadow = true
      toms.add(tom)
      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 0.045, 18),
        percussionHeadMaterial,
      )
      head.position.set(offsetX, 3.13 - index * 0.08, offsetZ)
      toms.add(head)
      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.06, 2.4, 8),
        percussionFrameMaterial,
      )
      stand.position.set(offsetX, 1.2, offsetZ)
      toms.add(stand)
    })
    toms.position.set(x, 6, z)
    stage.add(toms)
  }

  const addPercussionTable = (x: number, z: number, withBowls = false) => {
    const table = new THREE.Group()
    table.name = withBowls ? 'Banchan bowl percussion table' : 'Auxiliary percussion table'
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(18 / 12, 0.18, 12 / 12),
      new THREE.MeshStandardMaterial({ color: 0x232827, roughness: 0.9 }),
    )
    top.position.y = 3.15
    top.castShadow = true
    table.add(top)
    ;[-0.6, 0.6].forEach((legX) => {
      ;[-0.35, 0.35].forEach((legZ) => {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 3.05, 0.1),
          percussionFrameMaterial,
        )
        leg.position.set(legX, 1.55, legZ)
        table.add(leg)
      })
    })
    if (withBowls) {
      const bowlGeometry = new THREE.LatheGeometry([
        new THREE.Vector2(0, 0.02),
        new THREE.Vector2(0.12, 0.02),
        new THREE.Vector2(0.24, 0.18),
        new THREE.Vector2(0.22, 0.18),
        new THREE.Vector2(0.1, 0.05),
        new THREE.Vector2(0, 0.05),
      ], 24)
      const bowlMaterial = new THREE.MeshStandardMaterial({
        color: 0xeee8da,
        roughness: 0.28,
        side: THREE.DoubleSide,
      })
      ;[-0.5, 0, 0.5].forEach((bowlX) => {
        ;[-0.25, 0.25].forEach((bowlZ) => {
          const bowl = new THREE.Mesh(bowlGeometry, bowlMaterial)
          bowl.name = 'Banchan bowl'
          bowl.position.set(bowlX, 3.24, bowlZ)
          bowl.castShadow = true
          table.add(bowl)
        })
      })
    } else {
      ;[-0.35, 0.35, -0.35, 0.35].forEach((itemX, index) => {
        const item = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16 + index * 0.025, 0.16 + index * 0.025, 0.18, 12),
          index % 2 === 0 ? percussionMetalMaterial : percussionHeadMaterial,
        )
        item.position.set(itemX, 3.33, index < 2 ? -0.24 : 0.24)
        table.add(item)
      })
    }
    table.position.set(x, 6, z)
    stage.add(table)
  }

  const addTubularBells = (x: number, z: number) => {
    const bells = new THREE.Group()
    bells.name = 'Tubular bells'
    ;[-2, 2].forEach((frameX) => {
      const upright = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 6.5, 0.12),
        percussionFrameMaterial,
      )
      upright.position.set(frameX, 3.25, 0)
      bells.add(upright)
    })
    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.13, 0.13),
      percussionFrameMaterial,
    )
    crossbar.position.y = 6.35
    bells.add(crossbar)
    for (let index = 0; index < 12; index += 1) {
      const length = 4.7 - index * 0.13
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, length, 10),
        percussionMetalMaterial,
      )
      tube.position.set(-1.72 + index * 0.31, 6.1 - length / 2, 0)
      tube.castShadow = true
      bells.add(tube)
    }
    bells.position.set(x, 6, z)
    stage.add(bells)
  }

  const addBarPercussion = (
    name: string,
    width: number,
    depth: number,
    x: number,
    z: number,
    resonators: boolean,
    yaw: number,
  ) => {
    const instrument = new THREE.Group()
    instrument.name = name
    const isXylophone = name === 'Xylophone'
    const barCount = name === 'Glockenspiel' ? 12 : 18
    for (let index = 0; index < barCount; index += 1) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(width / barCount * 0.78, 0.09, depth * 0.72),
        new THREE.MeshStandardMaterial({
          color: isXylophone ? 0x75452e : resonators ? 0xb9a66a : 0x9fa9ad,
          metalness: isXylophone ? 0 : 0.55,
          roughness: 0.35,
        }),
      )
      bar.position.set(-width / 2 + (index + 0.5) * (width / barCount), 3.05, 0)
      instrument.add(bar)
      if (resonators && index % 2 === 0) {
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8),
          percussionMetalMaterial,
        )
        tube.position.set(bar.position.x, 2.12, 0)
        instrument.add(tube)
      }
    }
    ;[-width * 0.42, width * 0.42].forEach((legX) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 3, 0.1),
        percussionFrameMaterial,
      )
      leg.position.set(legX, 1.5, 0)
      instrument.add(leg)
    })
    instrument.position.set(x, 6, z)
    instrument.rotation.y = yaw
    stage.add(instrument)
  }

  const addRow = (
    section: string,
    color: number,
    xs: number[],
    stageHeight: number,
    z: number,
    faceConductor = true,
  ) => xs.forEach((x) => addChair(section, color, x, stageHeight, z, faceConductor))

  const musicStandMaterial = new THREE.MeshStandardMaterial({
    color: 0x171a19,
    metalness: 0.32,
    roughness: 0.58,
  })
  const addMusicStand = (
    section: string,
    pairX: number,
    stageHeight: number,
    pairZ: number,
    yaw: number,
    forwardDistance = 1.35,
    deskHeight = 2.55,
    deskTilt = -0.18,
    deskScale = 1,
  ) => {
    const stand = new THREE.Group()
    stand.name = `${section} shared music stand`
    stand.userData.orchestraSection = section
    stand.userData.facingYaw = yaw
    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    stand.position.set(
      pairX + forwardX * forwardDistance,
      stageHeight,
      pairZ + forwardZ * forwardDistance,
    )
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, deskHeight - 0.25, 8),
      musicStandMaterial,
    )
    pole.position.y = (deskHeight - 0.25) / 2 + 0.05
    stand.add(pole)
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 0.85, 0.08),
      musicStandMaterial,
    )
    desk.position.y = deskHeight
    desk.rotation.set(deskTilt, yaw, 0)
    desk.scale.setScalar(deskScale)
    desk.castShadow = true
    stand.add(desk)
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.06, 3),
      musicStandMaterial,
    )
    base.position.y = 0.04
    stand.add(base)
    stage.add(stand)
    return stand
  }

  const conductorStand = addMusicStand(
    'Conductor',
    conductorPosition.x,
    conductorPosition.y,
    conductorPosition.z - podiumBaseWidth / 2 - 0.8,
    0,
    0,
    podiumBaseHeight + podiumTopHeight + soleHeight + legHeight,
    -Math.PI / 2 + THREE.MathUtils.degToRad(10),
    1.5,
  )
  conductorStand.name = 'Conductor music stand'

  const addSideFacingStringPair = (
    section: string,
    color: number,
    pairX: number,
    stageHeight: number,
    chairZs: [number, number],
    forwardX: 1 | -1,
    omitRearChair = false,
  ) => {
    const pairZ = (chairZs[0] + chairZs[1]) / 2
    const targetYaw = Math.atan2(
      -(conductorPosition.x - pairX),
      -(conductorPosition.z - pairZ),
    )
    const straightYaw = forwardX === 1 ? -Math.PI / 2 : Math.PI / 2
    const yawDelta = Math.atan2(
      Math.sin(targetYaw - straightYaw),
      Math.cos(targetYaw - straightYaw),
    )
    const yaw = straightYaw + THREE.MathUtils.clamp(
      yawDelta,
      -THREE.MathUtils.degToRad(30),
      THREE.MathUtils.degToRad(30),
    )

    const frontZ = Math.max(...chairZs)
    const rotation = yaw - straightYaw
    const chairPositions = chairZs.map((z) => {
      const offsetZ = z - frontZ
      return {
        x: pairX + Math.sin(rotation) * offsetZ,
        z: frontZ + Math.cos(rotation) * offsetZ,
      }
    })
    chairPositions.forEach(({ x, z }, index) => {
      if (omitRearChair && chairZs[index] < frontZ) return
      addChair(section, color, x, stageHeight, z, false, yaw)
    })
    const standPosition = omitRearChair
      ? chairPositions[chairZs.indexOf(frontZ)]
      : {
          x: (chairPositions[0].x + chairPositions[1].x) / 2,
          z: (chairPositions[0].z + chairPositions[1].z) / 2,
        }
    const stand = addMusicStand(
      section,
      standPosition.x,
      stageHeight,
      standPosition.z,
      yaw,
      1.35,
    )
    if (omitRearChair) stand.name = `${section} individual music stand`
    return { chairPositions, yaw }
  }

  const firstViolinXs = [-20.5, -17.5, -14.5, -11.5, -8.5, -5.5, -2.5]
  const frontStringsSetback = 0.75
  const firstViolinDesks = firstViolinXs
    .filter((_, index) => scene !== 'barber' || index !== firstViolinXs.length - 1)
    .map((x, index) => ({
      x: x - 1 - frontStringsSetback,
      zBias: -Math.abs(x) * 0.025,
      single: index === 0 && scene !== 'barber',
      principal: index === firstViolinXs.length - (scene === 'barber' ? 2 : 1),
    }))
  if (scene === 'barber') {
    firstViolinDesks.push({
      x: firstViolinXs[0] - 1 - frontStringsSetback - 3,
      zBias: -Math.abs(firstViolinXs[0]) * 0.025,
      single: true,
      principal: false,
    })
  }
  firstViolinDesks.forEach(({ x: chairX, zBias, single, principal }) => {
    const yaw = -Math.PI / 2
    ;[-43.3, -46.1].forEach((z) => {
      if (single && z === -46.1) return
      addChair('First violins', 0x9a5b4a, chairX, 32 / 12, z + zBias, false, yaw)
    })
    const standZ = (single ? -43.3 : -44.7) + zBias
    const stand = addMusicStand(
      'First violins',
      chairX,
      32 / 12,
      standZ,
      yaw,
      1.35,
      2.55,
      0,
    )
    if (single) stand.name = 'First violins individual music stand'
    stand.userData.principalDesk = principal
  })
  ;[6.65, 9.65, 12.65, 15.65].forEach((x, index) => {
    const zBias = -x * 0.025
    const { yaw } = addSideFacingStringPair(
      'Violas',
      0x71805f,
      x - 3.35 + index * 0.25,
      4,
      [-49.6 + zBias, -52.4 + zBias],
      -1,
    )
    if (index === 3) {
      const keyboardYaw = yaw + Math.PI
      const fullKeyboardWidth = 1298 / 304.8
      const compactKeyboardWidth = 32.94 / 12
      const keyboardGap = 0.25
      const keyboardCenter = new THREE.Vector3(15.18235, 4, -52)
      const keyboardDirection = new THREE.Vector3(
        Math.cos(keyboardYaw), 0, -Math.sin(keyboardYaw),
      )
      const fullKeyboardPosition = keyboardCenter.clone().addScaledVector(
        keyboardDirection, (compactKeyboardWidth + keyboardGap) / 2,
      )
      const compactKeyboardPosition = keyboardCenter.clone().addScaledVector(
        keyboardDirection, -(fullKeyboardWidth + keyboardGap) / 2,
      )
      addKeyboard(
        'Inputs 12-13: Piano L/R', fullKeyboardWidth, 364 / 304.8, 141 / 304.8,
        fullKeyboardPosition.x, fullKeyboardPosition.z, 0x303b42, 4, keyboardYaw,
      )
      addKeyboard(
        'Inputs 14-15: Keyboard L/R', compactKeyboardWidth, 7.19 / 12, 3.31 / 12,
        compactKeyboardPosition.x, compactKeyboardPosition.z, 0x4b444f, 4, keyboardYaw,
      )
      addStool(21, 4, -50.5)
      addStool(21, 4, -54)
    }
  })

  ;[-20.5, -17.5, -14.5, -11.5, -8.5, -5.5, -2.5].forEach((x) => {
    const zBias = -Math.abs(x) * 0.025
    addSideFacingStringPair(
      'Second violins',
      0xb3814f,
      x - 0.8,
      4,
      [-49.4 + zBias, -52.2 + zBias],
      1,
      x === firstViolinXs[0],
    )
  })
  const celloXs = [4.5, 8, 11.5, 15]
  celloXs.forEach((sourceX) => {
    const x = sourceX + frontStringsSetback
    const yaw = Math.PI / 2
    ;[-43.3, -46.1].forEach((z) => {
      addChair('Cellos', 0x527488, x, 32 / 12, z - sourceX * 0.025, false, yaw)
      if (sourceX === celloXs[celloXs.length - 1]) {
        addStool(x + 4, 32 / 12, z - sourceX * 0.025)
      }
    })
    addMusicStand(
      'Cellos',
      x,
      32 / 12,
      -44.7 - sourceX * 0.025,
      yaw,
      1.6,
      2.55,
      0,
    )
  })

  const centerOutLeft = (count: number, pitch: number) =>
    Array.from({ length: count }, (_, index) => -pitch / 2 - index * pitch)
  const centerOutRight = (count: number, pitch: number) =>
    Array.from({ length: count }, (_, index) => pitch / 2 + index * pitch)

  const windsSetback = 1
  addRow('Flutes', 0x5f89a8, centerOutLeft(8, 2.5), 5, -57.7 - windsSetback, false)
  addRow('Oboes', 0xa97891, centerOutRight(4, 2.5), 5, -57.7 - windsSetback, false)
  addRow('Clarinets', 0x65947f, centerOutLeft(6, 2.5), 5, -61.3 - windsSetback, false)
  addRow('Bassoons', 0x9b754d, centerOutRight(4, 3), 5, -61.3 - windsSetback, false)
  addHarp(13, -60.1)
  addHarp(18.25, -60.1)

  const brassPercussionSetback = 1.5
  const brassRowZ = -66.1 - brassPercussionSetback
  const trumpetTromboneSetback = 0.75
  const hornStageRightShift = 1
  addRow('Horns', 0xb58a49, [-16.25, -13.75, -11.25, -8.75].map((x) => x - hornStageRightShift), 6, -66.1 - brassPercussionSetback)
  addRow('Trumpets', 0xb9a45d, [-6.25, -3.75, -1.25, 1.25, 3.75], 6, brassRowZ - trumpetTromboneSetback, false)
  addRow('Trombones', 0x9a6849, [6.25, 8.75, 11.25, 13.75], 6, brassRowZ - trumpetTromboneSetback, false)
  addRow('Tuba', 0x765940, [16.25], 6, brassRowZ - trumpetTromboneSetback, false)
  addRow('Horns', 0xb58a49, [-15, -12.5, -10].map((x) => x - hornStageRightShift), 6, -69.2 - brassPercussionSetback)
  const activePercussionStart = stage.children.length
  const centerTimpaniQuartet = (drums: THREE.Object3D[]) => {
    const drum29 = drums.find((drum) => drum.name === '29-inch timpano')
    const drum26 = drums.find((drum) => drum.name === '26-inch timpano')
    if (!drum29 || !drum26) throw new Error('Missing middle timpani for quartet centering.')
    const gapCenter = (
      new THREE.Box3().setFromObject(drum29).min.x
      + new THREE.Box3().setFromObject(drum26).max.x
    ) / 2
    drums.forEach((drum) => { drum.position.x -= gapCenter })
  }
  if (scene !== 'hisaishi' && scene !== 'ravel') {
    const rowZ = -74
    addTubularBells(10.2, -79)
    const malletRowZ = -73.7
    const malletRearRowZ = malletRowZ - 2.6
    addBarPercussion('Glockenspiel', 3.2, 1.5, 21.9, malletRowZ, false, 0)
    addBarPercussion('Xylophone', 5, 2.3, 17.4, malletRowZ, true, 0)
    addBarPercussion('Vibraphone', 6, 2.5, 10.3, malletRowZ, true, 0)
    addCrashCymbals(14.1, malletRowZ)
    addSnareDrum(8.1, malletRearRowZ)
    const timpaniStart = stage.children.length
    let rightEdge = 6
    ;[32, 29, 26, 23].forEach((diameter) => {
      const radius = diameter / 24 + 0.07
      addTimpani(diameter, rightEdge - radius, rowZ, 'Active timpani', Math.PI)
      rightEdge -= radius * 2 + 0.15
    })
    const quartet = stage.children.slice(timpaniStart)
    const quartetBounds = new THREE.Box3()
    quartet.forEach((object) => quartetBounds.union(new THREE.Box3().setFromObject(object)))
    const center = (quartetBounds.min.x + quartetBounds.max.x) / 2
    quartet.forEach((object) => { object.position.x -= center })
    const remainingStart = stage.children.length
    addTimpani(29, 0, rowZ, 'Second timpani pair', Math.PI)
    addTimpani(26, 0, rowZ, 'Second timpani pair', Math.PI)
    addSnareDrum(0, rowZ, 'Second snare drum')
    addConcertBassDrum(0, rowZ)
    addCymbalStand('Suspended cymbal', 0, rowZ)
    addTamTam(0, rowZ)
    addPercussionTable(0, rowZ)
    addCongas(0, rowZ)
    const remaining = stage.children.slice(remainingStart)
      .map((object) => ({ object, bounds: new THREE.Box3().setFromObject(object) }))
    const edge = -23.82
    const start = quartetBounds.min.x - center
    const totalWidth = remaining.reduce((sum, { bounds }) => sum + bounds.max.x - bounds.min.x, 0)
    const gap = (start - edge - totalWidth) / (remaining.length + 1)
    if (gap < 0.1) throw new Error('Barber percussion does not fit on the rear stage tier.')
    let nextEdge = start - gap
    remaining.forEach(({ object, bounds }) => {
      object.position.x += nextEdge - bounds.max.x
      nextEdge -= bounds.max.x - bounds.min.x + gap
    })
    const arcTimpani = (drums: THREE.Object3D[]) => {
      const bounds = new THREE.Box3()
      const radii = drums.map((drum) => {
        const drumBounds = new THREE.Box3().setFromObject(drum)
        bounds.union(drumBounds)
        return (drumBounds.max.x - drumBounds.min.x) / 2
      })
      let x = 0
      let z = -74.1
      drums.forEach((drum, index) => {
        if (index > 0) {
          const angle = THREE.MathUtils.degToRad(
            90 * (drums.length / 2 - index) / (drums.length - 2),
          )
          const distance = radii[index - 1] + radii[index] + 0.15
          x -= distance * Math.cos(angle)
          z += distance * Math.sin(angle)
        }
        drum.position.x = x
        drum.position.z = z
      })
      const arcBounds = new THREE.Box3()
      drums.forEach((drum) => arcBounds.union(new THREE.Box3().setFromObject(drum)))
      const offset = (bounds.min.x + bounds.max.x - arcBounds.min.x - arcBounds.max.x) / 2
      drums.forEach((drum) => { drum.position.x += offset })
    }
    if (scene === 'holst') {
      const timpani = [...quartet, ...remaining.slice(0, 2).map(({ object }) => object)]
      const bounds = new THREE.Box3()
      timpani.forEach((object) => bounds.union(new THREE.Box3().setFromObject(object)))
      timpani.forEach((object) => {
        stage.remove(object)
        disposeObject(object)
      })
      const diameters = [32, 26, 23, 29, 29, 26]
      const totalWidth = diameters.reduce((sum, diameter) => sum + diameter / 12 + 0.14, 0)
      const groupGap = bounds.max.x - bounds.min.x - totalWidth - 4 * 0.15
      if (groupGap <= 0) throw new Error('Holst timpani groups do not fit in the percussion row.')
      let edge = bounds.max.x
      diameters.forEach((diameter, index) => {
        const radius = diameter / 24 + 0.07
        addTimpani(diameter, edge - radius, rowZ,
          index < 3 ? 'First timpani trio' : 'Second timpani trio', Math.PI)
        edge -= radius * 2 + (index === 2 ? groupGap : 0.15)
      })
      const trios = stage.children.slice(-6)
      arcTimpani(trios.slice(0, 3))
      arcTimpani(trios.slice(3))
      const firstArcBounds = new THREE.Box3()
      const secondArcBounds = new THREE.Box3()
      trios.slice(0, 3).forEach((drum) => firstArcBounds.union(new THREE.Box3().setFromObject(drum)))
      trios.slice(3).forEach((drum) => secondArcBounds.union(new THREE.Box3().setFromObject(drum)))
      const shift = firstArcBounds.min.x - 0.5 - secondArcBounds.max.x
      trios.slice(3).forEach((drum) => { drum.position.x += shift })
      const stageLeftSnare = stage.children.slice(activePercussionStart)
        .find((object) => object.name === 'Snare drum')
      if (!stageLeftSnare) throw new Error('Missing stage-left snare for Holst timpani spacing.')
      const snareBounds = new THREE.Box3().setFromObject(stageLeftSnare)
      const blockShift = snareBounds.min.x - 0.5 - firstArcBounds.max.x
      trios.forEach((object) => {
        object.position.x += blockShift
      })
    } else {
      arcTimpani(quartet)
      centerTimpaniQuartet(quartet)
    }
    const spareTimpaniX = -6.1
    const sparePair = remaining.slice(0, 2)
    if (scene !== 'holst') {
      sparePair.forEach(({ object }, index) => {
        object.position.set(spareTimpaniX, 6, rowZ + 0.8 - index * 3)
      })
    }
    // Reserve the parked pair's width even in Holst so the other marks stay fixed.
    let stageRightEdge = spareTimpaniX
      - Math.max(...sparePair.map(({ bounds }) => (bounds.max.x - bounds.min.x) / 2)) - 0.5
    remaining.slice(2).forEach(({ object }) => {
      const bounds = new THREE.Box3().setFromObject(object)
      object.position.x += stageRightEdge - bounds.max.x
      stageRightEdge -= bounds.max.x - bounds.min.x + 0.5
    })
    const malletSnare = stage.children.slice(activePercussionStart)
      .find((object) => object.name === 'Snare drum')
    if (!malletSnare) throw new Error('Missing stage-left snare for mallet station.')
    malletSnare.position.set(6.1, 6, scene === 'holst' ? -77.5 : malletRowZ)
  } else {
  // Stage left is +X; percussion progresses toward stage right (-X).
  addBarPercussion('Glockenspiel', 3.2, 1.5, 21.5, -72.2, false, 0)
  addBarPercussion('Xylophone', 5, 2.3, 16.5, -72.2, true, 0)
  addPercussionTable(12.8, -72.2, true)
  addBarPercussion('Vibraphone', 6, 2.5, 8.3, -72.2, true, 0)
  const activeTimpaniDiameters = [32, 29, 26, 23]
  let timpaniX = 4.1
  let timpaniZ = -72.6
  activeTimpaniDiameters.forEach((diameter, index) => {
    if (index > 0) {
      // Adjacent rims touch along a deeper arc, open toward the player upstage.
      const angle = THREE.MathUtils.degToRad(45 * (2 - index))
      const centerDistance = (activeTimpaniDiameters[index - 1] + diameter) / 24 + 2 * 0.07
      timpaniX -= centerDistance * Math.cos(angle)
      timpaniZ += centerDistance * Math.sin(angle)
    }
    addTimpani(diameter, timpaniX, timpaniZ, 'Active timpani', Math.PI)
  })
  centerTimpaniQuartet(stage.children.filter((object) =>
    object.userData.orchestraSection === 'Active timpani',
  ))
  const stageRightPercussionStart = stage.children.length
  addSnareDrum(-3.65, -72.5)
  addTamTam(-5.6, -72.5)
  addCymbalStand('Hi-hat', -7.6, -72.5)
  addCrashCymbals(-9.05, -72.5)
  addConcertBassDrum(-11.05, -72.5)
  addPercussionTable(-13.2, -72.5)
  addTomSet(-15.5, -72.5)
  addCymbalStand('Suspended cymbal', -17.8, -72.5)
  addCongas(-20, -72.5)

  const timpaniBounds = new THREE.Box3()
  stage.children
    .filter((object) => object.userData.orchestraSection === 'Active timpani')
    .forEach((object) => timpaniBounds.union(new THREE.Box3().setFromObject(object)))
  const stageRightPercussion = stage.children.slice(stageRightPercussionStart)
    .map((object) => ({ object, bounds: new THREE.Box3().setFromObject(object) }))
  const railingInnerX = -tiers[0].width / 2 + 0.12 + 0.06
  const instrumentsWidth = stageRightPercussion.reduce(
    (width, { bounds }) => width + bounds.max.x - bounds.min.x,
    0,
  )
  const percussionGap = (timpaniBounds.min.x - railingInnerX - instrumentsWidth)
    / (stageRightPercussion.length + 1) / 2
  if (percussionGap <= 0) throw new Error('Stage-right percussion does not fit between timpani and railing.')
  let nextRightEdge = timpaniBounds.min.x - percussionGap
  stageRightPercussion.forEach(({ object, bounds }) => {
    object.position.x += nextRightEdge - bounds.max.x
    nextRightEdge -= bounds.max.x - bounds.min.x + percussionGap
  })
  stage.children.slice(activePercussionStart).forEach((object) => {
    object.position.z -= brassPercussionSetback
  })

  addTubularBells(10.2, -79)
  }

  const percussionSetback = 1.5
  stage.children.slice(activePercussionStart).forEach((instrument) => {
    if (instrument.name !== 'Tubular bells') instrument.position.z -= percussionSetback
  })

  stage.children.slice(activePercussionStart).forEach((instrument) => {
    instrument.userData.percussionActive = scene === 'barber'
      ? instrument.userData.orchestraSection === 'Active timpani'
      : scene === 'williams'
        ? instrument.userData.orchestraSection === 'Active timpani'
          || ['Snare drum', 'Second snare drum', '20-inch tam-tam', 'Crash cymbals on stand',
            'Vibraphone', 'Glockenspiel', 'Suspended cymbal', 'Auxiliary percussion table']
            .includes(instrument.name)
      : scene === 'korngold'
        ? instrument.userData.orchestraSection === 'Active timpani'
          || ['Tubular bells', 'Glockenspiel', 'Xylophone', 'Vibraphone',
            'Crash cymbals on stand', 'Second snare drum', 'Yamaha 7000 concert bass drum',
            '20-inch tam-tam', 'Auxiliary percussion table', 'Suspended cymbal']
            .includes(instrument.name)
      : scene === 'ravel'
        ? instrument.userData.orchestraSection === 'Active timpani'
          || ['Glockenspiel', 'Banchan bowl percussion table', 'Snare drum',
            'Crash cymbals on stand', 'Yamaha 7000 concert bass drum', 'Auxiliary percussion table']
            .includes(instrument.name)
      : scene === 'holst'
        ? instrument.name.endsWith('-inch timpano')
          || ['Second snare drum', 'Yamaha 7000 concert bass drum', 'Suspended cymbal', '20-inch tam-tam']
            .includes(instrument.name)
        : true
  })

  const individualStandSections = new Set([
    'Flutes', 'Oboes', 'Clarinets', 'Bassoons',
    'Horns', 'Trumpets', 'Trombones', 'Tuba', 'Basses',
  ])
  ;[...stage.children].forEach((player) => {
    if (!(player instanceof THREE.Group) || !individualStandSections.has(player.name)) return
    const isBass = player.name === 'Basses'
    const stand = addMusicStand(
      player.name,
      player.position.x,
      player.position.y,
      player.position.z,
      isBass ? Math.PI / 2 : player.rotation.y,
      isBass ? 1.6 : 1.35,
      isBass ? 3.1 : 2.55,
    )
    stand.name = `${player.name} individual music stand`
    if (isBass) {
      // Keep the stand fixed and move the stool away from it.
      player.position.x += 1
    }
  })

  const micStandMaterial = new THREE.MeshStandardMaterial({
    color: 0x181d1b, metalness: 0.55, roughness: 0.4,
  })
  const micMaterial = new THREE.MeshStandardMaterial({
    color: 0xb6bec1, metalness: 0.65, roughness: 0.3,
  })
  const addMicrophone = (
    name: string,
    base: THREE.Vector3,
    height: number,
    boomOffset: THREE.Vector3,
    target: THREE.Vector3,
    pencil = false,
    stereo = false,
    handheld = false,
  ) => {
    const stand = new THREE.Group()
    stand.name = name
    stand.userData.orchestraSection = name
    stand.userData.microphoneStand = true
    stand.userData.polarPattern = 'cardioid'
    stand.userData.aimTarget = target.clone()
    stand.position.copy(base)
    const addTube = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
      const direction = end.clone().sub(start)
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, direction.length(), 10),
        micStandMaterial,
      )
      tube.position.copy(start).add(end).multiplyScalar(0.5)
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      tube.castShadow = true
      stand.add(tube)
    }
    ;[0, 2 * Math.PI / 3, 4 * Math.PI / 3].forEach((angle) => {
      addTube(
        new THREE.Vector3(0, 0.22, 0),
        new THREE.Vector3(Math.cos(angle) * 0.55, 0.04, Math.sin(angle) * 0.55),
        0.04,
      )
    })
    const poleTop = new THREE.Vector3(0, height, 0)
    const capsulePosition = poleTop.clone().add(boomOffset)
    addTube(new THREE.Vector3(0, 0.05, 0), poleTop, 0.035)
    if (boomOffset.lengthSq() > 0) addTube(poleTop, capsulePosition, 0.025)
    if (stereo) {
      stand.userData.stereoTechnique = 'Spaced inward-facing pair: 1 foot, 45 degrees inward each'
      const centerDirection = target.clone().sub(base).sub(capsulePosition).setY(0).normalize()
      const sideways = new THREE.Vector3().crossVectors(centerDirection, new THREE.Vector3(0, 1, 0)).normalize()
      ;[-1, 1].forEach((side) => {
        const direction = centerDirection.clone().applyAxisAngle(
          new THREE.Vector3(0, 1, 0), side * Math.PI / 4,
        )
        const microphone = new THREE.Group()
        microphone.name = 'AKG C414 inward-facing cardioid microphone'
        microphone.position.copy(capsulePosition).addScaledVector(sideways, side * 0.5)
        const bodyDirection = new THREE.Vector3(0, 1, 0)
        const bodyRight = new THREE.Vector3().crossVectors(bodyDirection, direction).normalize()
        microphone.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(bodyRight, bodyDirection, direction),
        )
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.12), micStandMaterial)
        body.position.y = -0.28
        const grille = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.14), micMaterial)
        grille.position.y = 0
        body.castShadow = true
        grille.castShadow = true
        microphone.add(body, grille)
        stand.add(microphone)
        const mount = new THREE.Vector3(0, -0.44, 0)
          .applyQuaternion(microphone.quaternion).add(microphone.position)
        const barEnd = poleTop.clone().add(new THREE.Vector3(0, -0.65, 0))
          .addScaledVector(sideways, side * 0.5)
        addTube(barEnd, mount, 0.025)
        addTube(poleTop.clone().add(new THREE.Vector3(0, -0.65, 0)), barEnd, 0.025)
        addTube(poleTop, poleTop.clone().add(new THREE.Vector3(0, -0.65, 0)), 0.025)
      })
    } else if (handheld) {
      const direction = target.clone().sub(base).sub(capsulePosition).normalize()
      const microphone = new THREE.Group()
      microphone.name = 'SM58-style handheld speaking microphone'
      microphone.position.copy(capsulePosition)
      microphone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.04, 0.4, 12), micStandMaterial,
      )
      body.position.y = 0.2
      const grille = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), micMaterial)
      grille.position.y = 0.45
      body.castShadow = true
      grille.castShadow = true
      microphone.add(body, grille)
      stand.add(microphone)
    } else {
      const direction = target.clone().sub(base).sub(capsulePosition).normalize()
      const microphone = new THREE.Mesh(
        new THREE.CylinderGeometry(pencil ? 0.035 : 0.075, pencil ? 0.035 : 0.075, pencil ? 0.45 : 0.65, 12),
        micMaterial,
      )
      microphone.name = pencil ? 'Pencil microphone' : 'Condenser microphone'
      microphone.position.copy(capsulePosition).addScaledVector(direction, (pencil ? 0.45 : 0.65) / 2)
      microphone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      microphone.castShadow = true
      stand.add(microphone)
    }
    stage.add(stand)
    return stand
  }
  addMicrophone(
    'Inputs 1-2: Overheads L/R',
    new THREE.Vector3(0, 32 / 12, -41.1), 8, new THREE.Vector3(),
    new THREE.Vector3(0, 5, -54), false, true,
  )
  const speakingMicBase = conductorStand.position.clone().add(new THREE.Vector3(-2, 0, 0))
  addMicrophone(
    'Input 28: Speech',
    speakingMicBase, 4.2, new THREE.Vector3(),
    speakingMicBase.clone().add(new THREE.Vector3(0, 5.2, 0.35)), false, false, true,
  )
  if (scene === 'barber') {
    addMicrophone(
      'Input 3: Violin soloist',
      soloistPosition.clone().add(new THREE.Vector3(1.4, 0, 1.6)),
      3.9, new THREE.Vector3(),
      soloistPosition.clone().add(new THREE.Vector3(0.3, 4.65, 0.4)), true,
    )
  }
  ;[
    ['First violins', 'Violin 1 principal'],
    ['Second violins', 'Violin 2 principal'],
    ['Violas', 'Viola principal'],
    ['Cellos', 'Cello principal'],
    ['Basses', 'Bass principal'],
  ].forEach(([section, label], index) => {
    if (section === 'Basses') {
      const players = stage.children.filter((object) => object.name === 'Basses')
        .sort((a, b) => a.position.distanceToSquared(conductorPosition) - b.position.distanceToSquared(conductorPosition))
        .slice(0, 2)
      if (players.length !== 2) throw new Error('Missing principal bass pair for input 8.')
      const midpoint = players[0].position.clone().add(players[1].position).multiplyScalar(0.5)
      addMicrophone(
        'Input 8: Bass principal',
        midpoint.clone().add(new THREE.Vector3(-3.5, 0, 0)), 2,
        new THREE.Vector3(), midpoint.clone().add(new THREE.Vector3(0, 2.2, 0)), true,
      )
      return
    }
    const musicStands = stage.children.filter((object) =>
      object.userData.orchestraSection === section && object.name.endsWith('music stand'),
    )
    const firstDeskStand = musicStands.find((stand) => stand.userData.principalDesk === true)
      ?? [...musicStands].sort((a, b) =>
      a.position.distanceToSquared(conductorPosition) - b.position.distanceToSquared(conductorPosition),
    )[0]
    if (!firstDeskStand) throw new Error(`Missing first-desk music stand for ${section}.`)
    const facingYaw: unknown = firstDeskStand.userData.facingYaw
    if (typeof facingYaw !== 'number' || !Number.isFinite(facingYaw)) {
      throw new Error(`Missing music-stand facing direction for ${section}.`)
    }
    const forward = new THREE.Vector3(-Math.sin(facingYaw), 0, -Math.cos(facingYaw))
    const isCello = section === 'Cellos'
    const base = firstDeskStand.position.clone().addScaledVector(forward, 0.7)
    const instrumentHeight = section === 'Cellos' ? 1.7 : section === 'Basses' ? 2.7 : 2.3
    const instrumentTarget = firstDeskStand.position.clone()
      .addScaledVector(forward, -0.65).add(new THREE.Vector3(0, instrumentHeight, 0))
    addMicrophone(
      `Input ${index + 4}: ${label}`, base, isCello ? 2 : 3.6,
      isCello ? new THREE.Vector3() : forward.clone().multiplyScalar(-0.7).setY(0.225),
      instrumentTarget, true,
    )
  })
  const firstViolinSectionSetback = scene === 'barber' ? firstViolinXs[1] - firstViolinXs[0] : 0
  const firstViolinSectionOffset = new THREE.Vector3(
    -firstViolinSectionSetback, 0, -firstViolinSectionSetback * 0.025,
  )
  addMicrophone(
    'Input 9: Violin 1 section',
    new THREE.Vector3(-11.5, 32 / 12, -41.7).add(firstViolinSectionOffset), 5.5,
    new THREE.Vector3(0, 0, -0.8),
    new THREE.Vector3(-11.5, 4.5, -45).add(firstViolinSectionOffset),
  )
  const violinBlend = addMicrophone(
    'Input 10: Violin 2 section',
    new THREE.Vector3(-11.3, 4, -48.8), 5.5,
    new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(-11.3, 5.8, -51),
  )
  violinBlend.userData.polarPattern = 'omnidirectional'
  const lowStringBlend = addMicrophone(
    'Input 11: Viola / cello',
    new THREE.Vector3(8.2, 4, -48.8), 5.5,
    new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(8.2, 5, -48.5),
  )
  lowStringBlend.userData.polarPattern = 'omnidirectional'
  ;['Flutes', 'Oboes'].forEach((section, index) => {
    const second = stage.children.filter((object) => object.name === section)[1]
    if (!second) throw new Error(`Missing second player for ${section}.`)
    const rearSection = section === 'Flutes' ? 'Clarinets' : 'Bassoons'
    const rearPlayer = stage.children.filter((object) => object.name === rearSection)
      .sort((a, b) => Math.abs(a.position.x - second.position.x) - Math.abs(b.position.x - second.position.x))[0]
    if (!rearPlayer) throw new Error(`Missing rear wind row for ${section}.`)
    const target = second.position.clone().add(rearPlayer.position).multiplyScalar(0.5)
      .add(new THREE.Vector3(0, 2.5, 0))
    // Keep the feet fixed, but reach over the midpoint of the shifted wind rows.
    const microphoneReference = second.position.clone().add(new THREE.Vector3(0, 0, windsSetback))
    const base = microphoneReference.clone().add(new THREE.Vector3(0, 0, 1))
    addMicrophone(
      `Input ${index + 18}: ${section === 'Flutes' ? 'Flutes / clarinets' : 'Oboes / bassoons'}`, base, 7,
      new THREE.Vector3(target.x - base.x, 0, target.z - base.z),
      target,
    )
  })
  stage.children.filter((object) => object.name === 'Concert harp').forEach((harp, index) => {
    const offset = new THREE.Vector3(0, 0, 0.9).applyQuaternion(harp.quaternion)
    addMicrophone(
      `Input ${index + 16}: Harp ${index + 1}`, harp.position.clone().add(offset), 3.2,
      offset.clone().multiplyScalar(-0.5),
      harp.position.clone().add(new THREE.Vector3(0, 2.8, 0)),
    )
  })
  ;['Horns', 'Trumpets', 'Trombones', 'Tuba'].forEach((section, index) => {
    const players = stage.children.filter((object) => object.name === section)
    if (players.length === 0) throw new Error(`Missing brass players for ${section}.`)
    const center = players.reduce((sum, player) => sum.add(player.position), new THREE.Vector3())
      .multiplyScalar(1 / players.length)
    const isHorns = section === 'Horns'
    const isTuba = section === 'Tuba'
    const fourthTrombone = isTuba
      ? stage.children.filter((object) => object.name === 'Trombones')
        .sort((a, b) => b.position.x - a.position.x)[0]
      : undefined
    if (isTuba && !fourthTrombone) throw new Error('Missing fourth trombone for shared tuba microphone.')
    const lowBrassMidpoint = fourthTrombone
      ? center.clone().add(fourthTrombone.position).multiplyScalar(0.5)
      : center
    const rearRowZ = Math.min(...players.map((player) => player.position.z))
    const rearHorns = isHorns
      ? players.filter((player) => player.position.z < center.z)
      : []
    const hornBellTarget = rearHorns.reduce((sum, player) => sum.add(
      player.position.clone().add(
        new THREE.Vector3(0, 2.5, 0.7).applyQuaternion(player.quaternion),
      ),
    ), new THREE.Vector3()).multiplyScalar(rearHorns.length > 0 ? 1 / rearHorns.length : 1)
    const base = isHorns
      ? new THREE.Vector3(Math.min(...players.map((player) => player.position.x)) - 0.5, 6, rearRowZ - 1.4)
      : isTuba
        ? lowBrassMidpoint.clone().add(new THREE.Vector3(0, 0, 0.2))
        : new THREE.Vector3(center.x, center.y, brassRowZ + 2.7)
    const boom = isHorns
      ? new THREE.Vector3(1, 0, 0.5)
      : isTuba
        ? new THREE.Vector3(0, 0, 0.2)
        : new THREE.Vector3()
    // Instrument bodies are not modeled; bell targets are illustrative.
    const target = isHorns
      ? hornBellTarget
      : (isTuba ? lowBrassMidpoint : center).clone()
        .add(new THREE.Vector3(0, isTuba ? 3.2 : 2.5, 0.4))
    addMicrophone(
      `Input ${index + 20}: ${isTuba && scene === 'holst' ? 'Tuba / euphonium' : section}`,
      base, isTuba ? 4.5 : 4, boom, target,
    )
  })
  ;[
    { x: -19, targetX: -18, targetZ: -75.5 },
    { x: -9, targetX: -8, targetZ: -75.5 },
    { x: 2, targetX: 0, targetZ: -75.5 },
    { x: 18, targetX: 16, targetZ: -73.5 },
  ].forEach(({ x, targetX, targetZ }, index) => {
    addMicrophone(
      `Input ${index + 24}: Percussion ${index + 1}`,
      new THREE.Vector3(x, 6, -71), 6,
      new THREE.Vector3(0, 0, -0.5), new THREE.Vector3(targetX, 9, targetZ),
    )
  })

  const windsCameraRig = new THREE.Group()
  windsCameraRig.name = 'Stage camera facing center winds'
  windsCameraRig.position.set(0, 4, -54)
  const windsCamera = new THREE.Group()
  windsCamera.name = 'Stage camera facing center winds'
  windsCamera.userData.cameraView = true
  windsCamera.userData.focalLength = 36 / (2 * Math.tan(THREE.MathUtils.degToRad(120 / 2)))
  windsCamera.userData.horizontalFov = 120
  windsCamera.position.set(0, 6, 0)
  windsCamera.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(15)), -Math.cos(THREE.MathUtils.degToRad(15))),
  )
  const stageCameraBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.12), micStandMaterial)
  const stageCameraLens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16), micMaterial)
  stageCameraLens.rotation.x = Math.PI / 2
  stageCameraLens.position.z = -0.08
  windsCamera.add(stageCameraBody, stageCameraLens)
  windsCameraRig.add(windsCamera)
  const cameraPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 5.92, 10), micStandMaterial)
  cameraPole.position.y = 2.96
  cameraPole.castShadow = true
  windsCameraRig.add(cameraPole)
  const conductorCamera = new THREE.Group()
  conductorCamera.name = 'Phone camera facing conductor'
  conductorCamera.userData.cameraView = true
  conductorCamera.userData.focalLength = 26
  conductorCamera.userData.lensOffset = 0.06
  conductorCamera.position.set(0, 5.75, 0.12)
  conductorCamera.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    mannequin.position.clone().add(new THREE.Vector3(0, torso.position.y, 0))
      .sub(windsCameraRig.position).sub(conductorCamera.position).normalize(),
  )
  const phoneBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.035), micStandMaterial)
  const phoneLens = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), micMaterial)
  phoneLens.rotation.x = Math.PI / 2
  phoneLens.position.z = -0.0275
  conductorCamera.add(phoneBody, phoneLens)
  const phoneMount = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), micStandMaterial)
  phoneMount.position.set(0, conductorCamera.position.y, 0.06)
  windsCameraRig.add(conductorCamera, phoneMount)
  stage.add(windsCameraRig)

  const sectionMaterialsForHover = new Map<string, THREE.MeshStandardMaterial>()
  const replacedMaterials = new Set<THREE.MeshStandardMaterial>()
  stage.children.forEach((object) => {
    if (!(object instanceof THREE.Group)) return
    const originalSection = object.userData.orchestraSection
      ?? (object.name.endsWith('-inch timpano') ? 'Timpani' : object.name)
    const active: unknown = object.userData.percussionActive
    const section = typeof active === 'boolean'
      ? `${object.name} — ${active ? 'active' : 'parked / inactive'} in ${scene}`
      : originalSection
    object.userData.orchestraSection = section
    object.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      const cloneMaterial = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material
        replacedMaterials.add(material)
        const key = `${section}:${material.uuid}`
        let clone = sectionMaterialsForHover.get(key)
        if (!clone) {
          clone = material.clone()
          if (active === false) {
            clone.color.setHex(0x9a9e9b)
            clone.metalness = 0
            clone.roughness = 0.9
            clone.transparent = false
            clone.opacity = 1
          }
          sectionMaterialsForHover.set(key, clone)
        }
        return clone
      }
      part.material = Array.isArray(part.material)
        ? part.material.map(cloneMaterial)
        : cloneMaterial(part.material)
    })
  })
  replacedMaterials.forEach((material) => material.dispose())
  stage.position.z = stageOffset
  return stage
}

// Share the procedural scene without maintaining a second stage layout.
// oxlint-disable-next-line react/only-export-components
export const createStagePlan = (scene: StageScene = 'barber') => {
  const stage = createStage(scene)
  try {
    stage.updateMatrixWorld(true)
    const items = stage.children.filter((object) =>
      object instanceof THREE.Group || object.name.startsWith('Conductor podium'),
    ).map((object) => {
      const microphone = object.userData.microphoneStand === true
      const chair = object.name in orchestraColors
      const musicStand = object.name.endsWith('music stand')
      const bounds = new THREE.Box3().setFromObject(object)
      const capsules: { x: number; z: number }[] = []
      if (microphone) {
        object.children.filter((child) =>
          child.name === 'Pencil microphone' || child.name === 'Condenser microphone'
          || child.name === 'SM58-style handheld speaking microphone'
          || child.name === 'AKG C414 inward-facing cardioid microphone',
        ).forEach((child) => {
          const position = child.getWorldPosition(new THREE.Vector3())
          capsules.push({ x: position.x, z: position.z - stage.position.z })
        })
      }
      return {
        name: object.name,
        kind: microphone ? 'microphone' : chair ? 'chair' : musicStand ? 'musicStand' : 'fixture',
        x: object.position.x,
        z: object.position.z,
        yaw: object.rotation.y,
        color: `#${(orchestraColors[object.name] ?? 0x778779).toString(16).padStart(6, '0')}`,
        width: bounds.max.x - bounds.min.x,
        depth: bounds.max.z - bounds.min.z,
        centerX: (bounds.min.x + bounds.max.x) / 2,
        centerZ: (bounds.min.z + bounds.max.z) / 2 - stage.position.z,
        capsules,
        stairCount: typeof object.userData.stairCount === 'number' ? object.userData.stairCount : 0,
        percussionActive: typeof object.userData.percussionActive === 'boolean'
          ? object.userData.percussionActive : null,
      }
    })
    return items
  } finally {
    disposeObject(stage)
  }
}

const createStageLighting = () => {
  const rig = new THREE.Group()
  rig.name = 'Two suspended front-of-house stage lighting bars (schematic)'
  const metal = new THREE.MeshStandardMaterial({
    color: 0x242729, metalness: 0.65, roughness: 0.45,
  })
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe6bc, emissive: 0xffd49a, emissiveIntensity: 0.8,
  })
  const addTube = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
    const direction = end.clone().sub(start)
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 8), metal,
    )
    tube.position.copy(start).add(end).multiplyScalar(0.5)
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    rig.add(tube)
  }

  fohBarCenters.forEach((centerX) => {
    const barZ = -1.5
    const barHeight = 27
    ;[-0.4, 0.4].forEach((offsetZ) => {
      ;[barHeight, barHeight + 0.8].forEach((y) => {
        addTube(
          new THREE.Vector3(centerX - 5, y, barZ + offsetZ),
          new THREE.Vector3(centerX + 5, y, barZ + offsetZ), 0.07,
        )
      })
      for (let bay = 0; bay < 5; bay++) {
        const x = centerX - 5 + bay * 2
        addTube(
          new THREE.Vector3(x, barHeight, barZ + offsetZ),
          new THREE.Vector3(x + 2, barHeight + 0.8, barZ + offsetZ), 0.045,
        )
        addTube(
          new THREE.Vector3(x, barHeight + 0.8, barZ + offsetZ),
          new THREE.Vector3(x + 2, barHeight, barZ + offsetZ), 0.045,
        )
      }
    })
    ;[-5, 5].forEach((offsetX) => {
      addTube(
        new THREE.Vector3(centerX + offsetX, barHeight, barZ - 0.4),
        new THREE.Vector3(centerX + offsetX, barHeight, barZ + 0.4), 0.07,
      )
      addTube(
        new THREE.Vector3(centerX + offsetX, barHeight + 0.8, barZ),
        new THREE.Vector3(centerX + offsetX, roomHeight, barZ), 0.045,
      )
    })

    stageWashTargets.forEach((aim, index) => {
      const x = centerX + (index - 1.5) * 2.4
      addTube(new THREE.Vector3(x, barHeight, barZ), new THREE.Vector3(x, 26, barZ), 0.06)
      const fixture = new THREE.Group()
      fixture.name = `FOH ${centerX < 0 ? 'audience-left' : 'audience-right'} spotlight ${index + 1}`
      fixture.position.set(x, 25.8, barZ)
      const target = new THREE.Object3D()
      target.position.set(aim.x, aim.y, aim.z)
      fixture.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1), target.position.clone().sub(fixture.position).normalize(),
      )
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 1.25, 16), metal)
      housing.rotation.x = Math.PI / 2
      housing.position.z = 0.25
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), lensMaterial)
      lens.rotation.y = Math.PI
      lens.position.z = -0.39
      fixture.add(housing, lens)
      const spot = createStageSpotlight()
      spot.name = `${fixture.name} stage wash`
      spot.position.z = -0.42
      spot.target = target
      // Four shadow maps keep the overlapping eight-fixture wash affordable.
      spot.castShadow = index === 1 || index === 3
      spot.shadow.mapSize.set(1024, 1024)
      spot.shadow.camera.near = 1
      spot.shadow.camera.far = 125
      spot.shadow.bias = -0.0002
      spot.shadow.normalBias = 0.08
      fixture.add(spot)
      rig.add(fixture, target)
    })
  })
  return rig
}

const defaultHouseLightLevel = 15
const applyHouseLightLevel = (lighting: THREE.Object3D, level: number) => {
  applyRoomLightmapLevel(lighting, level)
  lighting.traverse((object) => {
    const stage = object.userData.stageCeilingLight === true
    if (object instanceof THREE.LineSegments && object.userData.roomEdge === true
      && object.material instanceof THREE.LineBasicMaterial) {
      object.material.opacity = 0.08 + 0.32 * level / 100
    }
    if (object instanceof THREE.SpotLight && object.userData.houseLight === true) {
      const minimum = stage ? stageCeilingMinimum : 0
      object.intensity = minimum + (fullHouseLightIntensity - minimum) * level / 100
    }
    if (object instanceof THREE.Mesh && object.userData.houseLightDiffuser === true
      && object.material instanceof THREE.MeshStandardMaterial) {
      const minimum = stage ? 0.6 : 0
      object.material.emissiveIntensity = minimum + (0.8 - minimum) * level / 100
    }
  })
}

const createCeilingLighting = () => {
  const lighting = new THREE.Group()
  lighting.name = 'Ceiling lights: adjustable stage and audience wash (schematic)'
  const fill = new THREE.AmbientLight(0xdce3ef, 0.025)
  fill.name = 'Minimal navigation fill; room indirect light is baked'
  lighting.add(fill)
  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x7b807d, roughness: 0.8 })
  ceilingZones.forEach((zone) => {
    const diffuserMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff0d7, emissive: 0xffe6bd, emissiveIntensity: 0,
    })
    const columns = ceilingColumns(zone.stage)
    columns.forEach((x) => {
      const fixture = new THREE.Group()
      fixture.name = `${zone.name} ceiling light`
      fixture.position.set(x, roomHeight - 0.2, zone.z)
      const housing = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 2), housingMaterial)
      const diffuser = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.04, 1.8), diffuserMaterial)
      diffuser.position.y = -0.12
      diffuser.userData.houseLightDiffuser = true
      diffuser.userData.stageCeilingLight = zone.stage
      const target = new THREE.Object3D()
      target.position.set(x, zone.stage ? 6 : 0, zone.z)
      const light = createCeilingSpotlight()
      light.name = `${fixture.name} downlight`
      light.userData.houseLight = true
      light.userData.stageCeilingLight = zone.stage
      light.target = target
      light.position.y = -0.15
      fixture.add(housing, diffuser, light)
      lighting.add(fixture, target)
    })
  })
  applyHouseLightLevel(lighting, defaultHouseLightLevel)
  return lighting
}

const createRoom = () => {
  const room = new THREE.Group()
  room.name = '100 by 160 by 31 foot room'

  const floorShape = new THREE.Shape()
  roomOutline.forEach(([x, z], index) => {
    if (index === 0) floorShape.moveTo(x, -z)
    else floorShape.lineTo(x, -z)
  })
  floorShape.closePath()
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(floorShape),
    new THREE.MeshStandardMaterial({ color: 0xd9ddd7, roughness: 0.95 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.userData.roomLightmapSurface = 'floor'
  room.add(floor)

  const ceiling = new THREE.Mesh(
    new THREE.ShapeGeometry(floorShape),
    new THREE.MeshStandardMaterial({ color: 0xe8ebe6, roughness: 0.95, side: THREE.BackSide }),
  )
  ceiling.name = 'Room ceiling'
  ceiling.rotation.x = -Math.PI / 2
  ceiling.position.y = roomHeight
  ceiling.userData.roomLightmapSurface = 'ceiling'
  room.add(ceiling)

  const addWall = (x1: number, z1: number, x2: number, z2: number, bottom = 0, height = roomHeight) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(Math.hypot(x2 - x1, z2 - z1), height, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xe8ebe6, side: THREE.DoubleSide, roughness: 0.95 }),
    )
    wall.position.set((x1 + x2) / 2, bottom + height / 2, (z1 + z2) / 2)
    wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1)
    wall.userData.roomLightmapSurface = roomWallAt(wall.position.x, wall.position.z)
    room.add(wall)
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(wall.geometry),
      new THREE.LineBasicMaterial({ color: 0x6d7a73, transparent: true, opacity: 0.4 }),
    )
    edge.position.copy(wall.position)
    edge.rotation.copy(wall.rotation)
    edge.userData.roomEdge = true
    room.add(edge)
  }
  addWall(-37, -80, 50, -80)
  addWall(50, -80, 50, 80)
  addWall(-37, -80, -37, -63)
  addWall(-37, -63, -40, -63)
  addWall(-40, -63, -40, -60)
  addWall(-40, -60, -41, -60)
  addWall(-47, -60, -50, -60)
  addWall(-47, -60, -41, -60, 7, roomHeight - 7)
  addWall(-50, -60, -50, -56)
  addWall(-50, -36, -50, 80)
  addWall(-50, -56, -50, -36, 14, roomHeight - 14)
  const garage = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 14),
    new THREE.MeshStandardMaterial({ color: 0xa8b1aa, side: THREE.DoubleSide, roughness: 0.85 }),
  )
  garage.rotation.y = Math.PI / 2
  garage.position.set(-50, 7, -46)
  garage.name = 'Flush garage door'
  garage.userData.roomLightmapSurface = roomWallAt(-50, -46)
  room.add(garage)

  const addDoorPair = (x: number, z: number) => {
    ;[x + 1.5, x + 4.5].forEach((centerX) => {
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(2.96, 7, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x81968b, side: THREE.DoubleSide }),
      )
      leaf.position.set(centerX, 3.5, z)
      leaf.name = 'Closed door leaf'
      leaf.userData.roomLightmapSurface = roomWallAt(centerX, z)
      room.add(leaf)
    })
  }
  addDoorPair(-47, -60)
  let wallStart = -50
  ;[-50, 10, 22, 34].forEach((x) => {
    if (x > wallStart) addWall(wallStart, 80, x, 80)
    addWall(x, 80, x + 6, 80, 7, roomHeight - 7)
    addDoorPair(x, 80)
    wallStart = x + 6
  })
  addWall(wallStart, 80, 50, 80)

  const deskMaterial = new THREE.MeshStandardMaterial({ color: 0x58645d, roughness: 0.8 })
  const techPlatform = new THREE.Mesh(new THREE.BoxGeometry(24, 3, 8), deskMaterial)
  techPlatform.name = 'Tech and camera platform: 24 by 8 feet, 3 feet high'
  techPlatform.position.set(-9, 1.5, 76)
  techPlatform.castShadow = true
  techPlatform.receiveShadow = true
  room.add(techPlatform)
  const techEquipment = new THREE.Group()
  techEquipment.name = 'Elevated tech desks, chairs and camera'
  techEquipment.position.y = 3
  room.add(techEquipment)
  ;[-16.5, -7.5].forEach((x) => {
    const desk = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 2), deskMaterial)
    desk.position.set(x, 2.5, 73.5)
    techEquipment.add(desk)
    ;[-3.5, 3.5].forEach((offset) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 1.6), deskMaterial)
      leg.position.set(x + offset, 1.2, 73.5)
      techEquipment.add(leg)
    })
    const chair = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), deskMaterial)
    chair.position.set(x, 1.4, 76)
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 0.15), deskMaterial)
    back.position.set(x, 2.2, 77)
    techEquipment.add(chair, back)
    ;[-0.75, 0.75].forEach((offsetX) => {
      ;[-0.75, 0.75].forEach((offsetZ) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), deskMaterial)
        leg.name = 'Tech chair leg'
        leg.position.set(x + offsetX, 0.65, 76 + offsetZ)
        leg.castShadow = true
        techEquipment.add(leg)
      })
    })
  })
  const cameraBase = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 8), deskMaterial)
  cameraBase.position.set(0, 0.06, 76)
  techEquipment.add(cameraBase)
  const cameraBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.2), deskMaterial)
  cameraBody.position.set(0, 4.5, 76)
  cameraBody.name = 'Rear tech camera'
  cameraBody.userData.cameraView = true
  cameraBody.userData.focalLength = 85
  techEquipment.add(cameraBody)
  ;[0, 2 * Math.PI / 3, 4 * Math.PI / 3].forEach((angle) => {
    const foot = new THREE.Vector3(Math.cos(angle), 0.1, 76 + Math.sin(angle))
    const top = new THREE.Vector3(0, 4.2, 76)
    const direction = top.clone().sub(foot)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, direction.length(), 8), deskMaterial)
    leg.position.copy(top).add(foot).multiplyScalar(0.5)
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    techEquipment.add(leg)
  })

  room.traverse((object) => {
    if (object instanceof THREE.Mesh && typeof object.userData.roomLightmapSurface === 'string') {
      attachRoomLightmap(object, object.userData.roomLightmapSurface)
    }
  })
  applyRoomLightmapLevel(room, defaultHouseLightLevel)
  return room
}

const seatTransform = (seat: VenueSeat, starts = zoneStart, centerColumns = 17) => {
  const seatCenter = seat.column + (seat.span - 1) / 2
  const baseZ = starts[seat.zone] + seat.row * rowPitch
  const innerSectionEdge = centerColumns * seatPitch / 2 + 8 + seatPitch / 2

  if (seat.position === 'Center') {
    return {
      x: (seatCenter - (seat.columns - 1) / 2) * seatPitch,
      z: baseZ,
      yaw: 0,
    }
  }

  if (seat.position === 'Left') {
    const relativeX = -(seat.columns - 1 - seatCenter) * seatPitch
    return {
      x: -innerSectionEdge + Math.cos(sideRowAngle) * relativeX,
      z: baseZ + Math.sin(sideRowAngle) * relativeX,
      yaw: -sideRowAngle,
    }
  }

  const relativeX = seatCenter * seatPitch
  return {
    x: innerSectionEdge + Math.cos(sideRowAngle) * relativeX,
    z: baseZ - Math.sin(sideRowAngle) * relativeX,
    yaw: sideRowAngle,
  }
}

const createAudience = (seats: VenueSeat[]) => {
  const audience = new THREE.Group()
  audience.name = 'Audience seating'

  type SeatView = ReturnType<typeof seatTransform> & { id: string }
  const chairBuckets = new Map<string, SeatView[]>()
  const wheelchairSeats: VenueSeat[] = []
  const starts = { ...zoneStart }
  const zones = ['Front', 'Middle', 'Rear'] as const
  zones.slice(1).forEach((zone, index) => {
    const previous = zones[index]
    const rows = Math.max(1, ...seats.filter((seat) => seat.zone === previous).map((seat) => seat.row + 1))
    starts[zone] = starts[previous] + (rows - 1) * rowPitch + 1.71 + 8
  })
  const transformForSeat = (seat: VenueSeat) => seatTransform(
    seat,
    starts,
    seats.find((candidate) => candidate.zone === seat.zone && candidate.position === 'Center')?.columns ?? 17,
  )

  seats.forEach((seat) => {
    if (seat.kind === 'wheelchair') {
      wheelchairSeats.push(seat)
      return
    }

    const key = `${seat.category}-${seat.occupied ? 'occupied' : 'empty'}`
    const bucket = chairBuckets.get(key) ?? []
    bucket.push({ ...transformForSeat(seat), id: seat.id })
    chairBuckets.set(key, bucket)
  })

  const cushionGeometry = new THREE.BoxGeometry(1.35, 0.28, 1.35)
  const backGeometry = new THREE.BoxGeometry(1.35, 1.35, 0.22)
  const legHeight = 1.25 - 0.28 / 2
  const legGeometry = new THREE.BoxGeometry(0.1, legHeight, 0.1)
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const matrix = new THREE.Matrix4()
  const backOffset = new THREE.Vector3()
  const legOffset = new THREE.Vector3()

  chairBuckets.forEach((transforms, key) => {
    const [category, occupancy] = key.split('-') as [
      Exclude<VenueSeatCategory, 'accessible'>,
      'occupied' | 'empty',
    ]
    const occupied = occupancy === 'occupied'
    const material = new THREE.MeshStandardMaterial({
      color: categoryColors[category],
      opacity: occupied ? 1 : 0.24,
      roughness: 0.72,
      transparent: !occupied,
    })
    const cushions = new THREE.InstancedMesh(cushionGeometry, material, transforms.length)
    const backs = new THREE.InstancedMesh(backGeometry, material.clone(), transforms.length)
    const legs = new THREE.InstancedMesh(
      legGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x202522,
        metalness: 0.35,
        roughness: 0.58,
        opacity: occupied ? 1 : 0.24,
        transparent: !occupied,
      }),
      transforms.length * 4,
    )
    const legSeatViews: SeatView[] = []

    transforms.forEach((transform, index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.yaw)
      position.set(transform.x, 1.25, transform.z)
      matrix.compose(position, quaternion, scale)
      cushions.setMatrixAt(index, matrix)

      backOffset.set(0, 1.92, 0.62).applyQuaternion(quaternion)
      position.set(
        transform.x + backOffset.x,
        backOffset.y,
        transform.z + backOffset.z,
      )
      matrix.compose(position, quaternion, scale)
      backs.setMatrixAt(index, matrix)
      ;[-0.5, 0.5].forEach((localX, xIndex) => {
        ;[-0.5, 0.5].forEach((localZ, zIndex) => {
          legOffset.set(localX, legHeight / 2, localZ).applyQuaternion(quaternion)
          position.set(
            transform.x + legOffset.x,
            legOffset.y,
            transform.z + legOffset.z,
          )
          matrix.compose(position, quaternion, scale)
          const legIndex = index * 4 + xIndex * 2 + zIndex
          legs.setMatrixAt(legIndex, matrix)
          legSeatViews[legIndex] = transform
        })
      })
    })

    cushions.instanceMatrix.needsUpdate = true
    backs.instanceMatrix.needsUpdate = true
    legs.instanceMatrix.needsUpdate = true
    cushions.userData.seatViews = transforms
    backs.userData.seatViews = transforms
    legs.userData.seatViews = legSeatViews
    cushions.castShadow = occupied
    backs.castShadow = occupied
    legs.castShadow = occupied
    audience.add(cushions, backs, legs)
  })

  const wheelchairTexture = createWheelchairTexture()
  const wheelchairMaterials = {
    occupied: new THREE.MeshStandardMaterial({
      map: wheelchairTexture,
      roughness: 1,
      side: THREE.DoubleSide,
      transparent: true,
    }),
    empty: new THREE.MeshStandardMaterial({
      map: wheelchairTexture,
      roughness: 1,
      opacity: 0.28,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  }

  wheelchairSeats.forEach((seat) => {
    const transform = transformForSeat(seat)
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(seatPitch * 1.9, 2.4),
      wheelchairMaterials[seat.occupied ? 'occupied' : 'empty'],
    )
    marker.position.set(transform.x, 0.035, transform.z)
    marker.receiveShadow = true
    marker.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.yaw)
    marker.rotateX(-Math.PI / 2)
    marker.userData.seatView = { ...transform, id: seat.id }
    audience.add(marker)
  })

  return audience
}

type ViewPreset = 'overview' | 'birds-eye' | 'rear' | 'stage' | 'conductor'
const cameraPresetNames = {
  rear: 'Rear tech camera',
  stage: 'Stage camera facing center winds',
  conductor: 'Phone camera facing conductor',
}

export default function Venue3D({ seats, audienceTotal, totalCapacity, stageScene, onSceneChange, controlsHost }: Venue3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsDockRef = useRef<HTMLDivElement>(null)
  const controlsToggleRef = useRef<HTMLButtonElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const previousFullscreenRef = useRef(false)
  const axisGuideRef = useRef<SVGSVGElement>(null)
  const axisGuideId = useId()
  const helpId = useId()
  const controlsId = useId()
  const sceneRef = useRef<THREE.Scene | null>(null)
  const viewPresetRef = useRef<((preset: ViewPreset) => void) | null>(null)
  const stageSceneRef = useRef<((scene: StageScene) => void) | null>(null)
  const [viewPreset, setViewPreset] = useState<ViewPreset | 'custom'>('birds-eye')
  const [error, setError] = useState<string | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [fullscreenControlsHost, setFullscreenControlsHost] = useState<HTMLDivElement | null>(null)
  const isFullscreen = fullscreenControlsHost !== null
  const [isSeatView, setIsSeatView] = useState(false)
  const [cameraViewLabel, setCameraViewLabel] = useState<string | null>("Bird's eye view")
  const [cameraLens, setCameraLens] = useState<number | null>(null)
  const [cameraHorizontalFov, setCameraHorizontalFov] = useState<number | null>(null)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [hoveredSection, setHoveredSection] = useState<string | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isControlsOpen, setIsControlsOpen] = useState(false)
  const [houseLightLevel, setHouseLightLevel] = useState(defaultHouseLightLevel)

  useEffect(() => {
    const syncFullscreenState = () => {
      setFullscreenControlsHost(
        document.fullscreenElement === containerRef.current ? containerRef.current : null,
      )
      setIsControlsOpen(false)
    }
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  useEffect(() => {
    if (previousFullscreenRef.current === isFullscreen) return
    previousFullscreenRef.current = isFullscreen
    const toggle = controlsToggleRef.current
    if (!isFullscreen && toggle && toggle.getClientRects().length > 0) toggle.focus()
    else fullscreenButtonRef.current?.focus()
  }, [isFullscreen])

  useEffect(() => {
    if (!isControlsOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlsDockRef.current?.contains(event.target)) {
        setIsControlsOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsControlsOpen(false)
      controlsToggleRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isControlsOpen])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let frame = 0
    let renderer: THREE.WebGLRenderer | null = null
    let resizeObserver: ResizeObserver | null = null

    try {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xe8ece7)
      sceneRef.current = scene

      const overviewFov = 65
      const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400)
      const overviewPosition = new THREE.Vector3(45, 29, 75)
      const overviewTarget = new THREE.Vector3(0, 5, -10)
      const birdsEyePosition = new THREE.Vector3(0, 29, -24)
      const birdsEyeTarget = new THREE.Vector3(0, 4, -57.75)
      camera.position.copy(birdsEyePosition)
      camera.lookAt(birdsEyeTarget)

      const activeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer = activeRenderer
      activeRenderer.outputColorSpace = THREE.SRGBColorSpace
      activeRenderer.toneMapping = THREE.ACESFilmicToneMapping
      activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      activeRenderer.shadowMap.enabled = true
      activeRenderer.shadowMap.type = THREE.PCFShadowMap
      container.prepend(activeRenderer.domElement)

      const controls = new OrbitControls(camera, activeRenderer.domElement)
      controls.target.copy(birdsEyeTarget)
      controls.enableRotate = false
      controls.enableDamping = false
      controls.maxDistance = 280
      controls.minDistance = 0.5
      controls.maxPolarAngle = Math.PI - 0.01

      scene.add(createStageLighting(), createCeilingLighting())
      let stage = createStage()
      let currentStageScene: StageScene = 'barber'
      scene.add(createRoom(), stage)

      type CameraTransition = {
        startedAt: number
        fromPosition: THREE.Vector3
        toPosition: THREE.Vector3
        fromRotation: THREE.Quaternion
        toRotation: THREE.Quaternion
        fromTargetDistance: number
        toTargetDistance: number
        fromFov: number
        toFov: number
      }
      let cameraTransition: CameraTransition | null = null
      let selectedFocalLength: number | null = null
      const startCameraTransition = (
        toPosition: THREE.Vector3,
        toTarget: THREE.Vector3,
        toFov: number,
      ) => {
        constrainCameraPosition(toPosition)
        cameraTransition = {
          startedAt: performance.now(),
          fromPosition: camera.position.clone(),
          toPosition,
          fromRotation: camera.quaternion.clone(),
          toRotation: new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(toPosition, toTarget, camera.up),
          ),
          fromTargetDistance: camera.position.distanceTo(controls.target),
          toTargetDistance: toPosition.distanceTo(toTarget),
          fromFov: camera.fov,
          toFov,
        }
        controls.enabled = false
      }
      const onOrbitStart = () => {
        if (!cameraTransition) setViewPreset('custom')
      }
      controls.addEventListener('start', onOrbitStart)

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const highlightMaterials = new Map<string, Set<THREE.MeshStandardMaterial>>()
      const collectHighlightMaterials = () => stage.children.forEach((group) => {
        const section = group.userData.orchestraSection
        if (typeof section !== 'string') return
        const materials = highlightMaterials.get(section) ?? new Set<THREE.MeshStandardMaterial>()
        group.traverse((part) => {
          if (!(part instanceof THREE.Mesh)) return
          const list = Array.isArray(part.material) ? part.material : [part.material]
          list.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) materials.add(material)
          })
        })
        highlightMaterials.set(section, materials)
      })
      collectHighlightMaterials()
      let activeSection: string | null = null
      const selectSection = (section: string | null) => {
        if (section === activeSection) return
        if (activeSection) {
          highlightMaterials.get(activeSection)?.forEach((material) => material.emissive.setHex(0))
        }
        activeSection = section
        if (section) {
          highlightMaterials.get(section)?.forEach((material) => material.emissive.setHex(0x554522))
        }
        setHoveredSection(section)
      }
      stageSceneRef.current = (nextScene) => {
        if (nextScene === currentStageScene) return
        try {
          const nextStage = createStage(nextScene)
          selectSection(null)
          scene.remove(stage)
          disposeObject(stage)
          stage = nextStage
          scene.add(stage)
          highlightMaterials.clear()
          collectHighlightMaterials()
          currentStageScene = nextScene
          setInteractionError(null)
        } catch (caughtError) {
          console.error('Could not switch the stage scene.', caughtError)
          setInteractionError('Could not load the stage scene. Please reload to try again.')
        }
      }
      const selectCamera = (cameraModel: THREE.Object3D) => {
        const focalLength: unknown = cameraModel.userData.focalLength
        if (typeof focalLength !== 'number' || focalLength <= 0 || !Number.isFinite(focalLength)) {
          console.error('Invalid camera focal length.', cameraModel.name, focalLength)
          setInteractionError('This camera has no valid lens configuration.')
          return
        }
        setInteractionError(null)
        selectedFocalLength = focalLength
        setCameraLens(focalLength)
        setCameraHorizontalFov(
          typeof cameraModel.userData.horizontalFov === 'number' ? cameraModel.userData.horizontalFov : null,
        )
        controls.maxPolarAngle = Math.PI - 0.01
        cameraModel.updateWorldMatrix(true, false)
        const orientation = cameraModel.getWorldQuaternion(new THREE.Quaternion())
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation)
        const lensPosition = cameraModel.getWorldPosition(new THREE.Vector3())
          .addScaledVector(forward, cameraModel.userData.lensOffset
            ?? (cameraModel.userData.horizontalFov === 120 ? 0.14 : 0.95))
        const target = cameraModel.name === 'Rear tech camera'
          ? new THREE.Vector3(0, 5, -57.75)
          : lensPosition.clone().addScaledVector(forward, 60)
        selectSection(null)
        startCameraTransition(lensPosition, target, cameraViewportFov(focalLength, camera.aspect))
        setIsSeatView(false)
        setCameraViewLabel(cameraModel.name)
        setViewPreset(
          cameraModel.name === cameraPresetNames.rear ? 'rear'
            : cameraModel.name === cameraPresetNames.conductor ? 'conductor' : 'stage',
        )
      }
      viewPresetRef.current = (preset) => {
        if (preset !== 'overview' && preset !== 'birds-eye') {
          const modelName = cameraPresetNames[preset]
          let model: THREE.Object3D | undefined
          scene.traverse((object) => {
            if (object.name === modelName && object.userData.cameraView === true) model = object
          })
          if (!model) {
            console.error('Camera preset model not found.', modelName)
            setInteractionError('This camera viewpoint is unavailable.')
            return
          }
          selectCamera(model)
          return
        }
        selectSection(null)
        setViewPreset(preset)
        setInteractionError(null)
        setIsSeatView(false)
        setCameraViewLabel(preset === 'birds-eye' ? "Bird's eye view" : null)
        setCameraLens(null)
        setCameraHorizontalFov(null)
        selectedFocalLength = null
        controls.maxPolarAngle = Math.PI - 0.01
        startCameraTransition(
          preset === 'birds-eye' ? birdsEyePosition.clone() : overviewPosition.clone(),
          preset === 'birds-eye' ? birdsEyeTarget.clone() : overviewTarget.clone(),
          preset === 'birds-eye' ? 70 : overviewFov,
        )
      }
      const onPointerMove = (event: PointerEvent) => {
        if (pointerStart?.id === event.pointerId && !cameraTransition) {
          if (!pointerStart.dragged
            && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) <= 6) return
          pointerStart.dragged = true
          if (pointerStart.pan) {
            selectSection(null)
            return
          }
          activeRenderer.domElement.classList.add('is-aiming')
          aimCamera(
            camera, controls.target,
            event.clientX - pointerStart.lastX, event.clientY - pointerStart.lastY,
            activeRenderer.domElement.clientHeight,
          )
          pointerStart.lastX = event.clientX
          pointerStart.lastY = event.clientY
          selectSection(null)
          setIsSeatView(false)
          setViewPreset('custom')
          setCameraViewLabel(null)
          setCameraLens(null)
          setCameraHorizontalFov(null)
          selectedFocalLength = null
          return
        }
        if (event.buttons || cameraTransition) {
          selectSection(null)
          return
        }
        const bounds = activeRenderer.domElement.getBoundingClientRect()
        pointer.set(
          (event.clientX - bounds.left) / bounds.width * 2 - 1,
          -((event.clientY - bounds.top) / bounds.height * 2 - 1),
        )
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(scene.children, true)[0]
        let object: THREE.Object3D | null = hit?.object ?? null
        while (object && typeof object.userData.orchestraSection !== 'string') {
          object = object.parent
        }
        selectSection(object ? object.userData.orchestraSection : null)
      }
      const onPointerLeave = () => selectSection(null)
      let pointerStart: {
        id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean; pan: boolean
      } | null = null
      const cancelPointerLook = () => {
        activeRenderer.domElement.classList.remove('is-aiming')
        if (pointerStart && activeRenderer.domElement.hasPointerCapture(pointerStart.id)) {
          activeRenderer.domElement.releasePointerCapture(pointerStart.id)
        }
        pointerStart = null
      }
      const onPointerDown = (event: PointerEvent) => {
        activeRenderer.domElement.focus({ preventScroll: true })
        if (!event.isPrimary) {
          cancelPointerLook()
          return
        }
        if (event.button === 0 && !cameraTransition) {
          pointerStart = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            lastX: event.clientX, lastY: event.clientY, dragged: false,
            pan: event.shiftKey || event.ctrlKey || event.metaKey,
          }
          activeRenderer.domElement.setPointerCapture(event.pointerId)
        }
      }
      const onPointerUp = (event: PointerEvent) => {
        if (!pointerStart || pointerStart.id !== event.pointerId || event.button !== 0) return
        const dragged = pointerStart.dragged
        const pan = pointerStart.pan
        const movement = Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        )
        cancelPointerLook()
        if (pan || dragged || movement > 6 || cameraTransition) return

        const bounds = activeRenderer.domElement.getBoundingClientRect()
        pointer.x = (event.clientX - bounds.left) / bounds.width * 2 - 1
        pointer.y = -((event.clientY - bounds.top) / bounds.height * 2 - 1)
        raycaster.setFromCamera(pointer, camera)

        const intersections = raycaster.intersectObjects(scene.children, true)
        for (const intersection of intersections) {
          const object = intersection.object
          let cameraModel: THREE.Object3D | null = object
          while (cameraModel && cameraModel.userData.cameraView !== true) {
            cameraModel = cameraModel.parent
          }
          if (cameraModel) {
            selectCamera(cameraModel)
            break
          }
          let seatView: { x: number; z: number; yaw: number; id: string } | undefined

          if (object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
            const seatViews = object.userData.seatViews as
              | Array<{ x: number; z: number; yaw: number; id: string }>
              | undefined
            seatView = seatViews?.[intersection.instanceId]
          } else {
            seatView = object.userData.seatView as
              | { x: number; z: number; yaw: number; id: string }
              | undefined
          }

          if (!seatView) continue
          const headPosition = new THREE.Vector3(
            seatView.x + Math.sin(seatView.yaw) * 0.18,
            4.2,
            seatView.z + Math.cos(seatView.yaw) * 0.18,
          )
          startCameraTransition(
            headPosition,
            new THREE.Vector3(0, 4.2, -60),
            35,
          )
          setIsSeatView(true)
          setViewPreset('custom')
          setCameraViewLabel(null)
          setCameraLens(null)
          setCameraHorizontalFov(null)
          selectedFocalLength = null
          controls.maxPolarAngle = Math.PI - 0.01
          break
        }
      }
      activeRenderer.domElement.addEventListener('pointerdown', onPointerDown)
      activeRenderer.domElement.addEventListener('pointerup', onPointerUp)
      activeRenderer.domElement.addEventListener('pointermove', onPointerMove)
      activeRenderer.domElement.addEventListener('pointerleave', onPointerLeave)
      activeRenderer.domElement.addEventListener('pointercancel', cancelPointerLook)
      activeRenderer.domElement.addEventListener('lostpointercapture', cancelPointerLook)
      window.addEventListener('blur', cancelPointerLook)
      activeRenderer.domElement.tabIndex = 0
      activeRenderer.domElement.setAttribute('aria-label', '3D venue navigation. Drag to look around, Shift-drag to pan. WASD to fly, Q down, E up, Shift to move faster.')
      const flightKeys = new Set<string>()
      const navigationKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'])
      const clearFlightKeys = () => flightKeys.clear()
      const onFlightKeyDown = (event: KeyboardEvent) => {
        if (!navigationKeys.has(event.code) || event.ctrlKey || event.altKey || event.metaKey) return
        event.preventDefault()
        flightKeys.add(event.code)
      }
      const onFlightKeyUp = (event: KeyboardEvent) => {
        flightKeys.delete(event.code)
      }
      activeRenderer.domElement.addEventListener('keydown', onFlightKeyDown)
      window.addEventListener('keyup', onFlightKeyUp)
      activeRenderer.domElement.addEventListener('blur', clearFlightKeys)
      window.addEventListener('blur', clearFlightKeys)
      const flightForward = new THREE.Vector3()
      const flightRight = new THREE.Vector3()
      const flightMovement = new THREE.Vector3()
      let previousFrameTime = performance.now()

      const resize = () => {
        const width = Math.max(container.clientWidth, 1)
        const height = Math.max(container.clientHeight, 1)
        camera.aspect = width / height
        setFrameSize({
          width: Math.min(width, height * videoAspect),
          height: Math.min(height, width / videoAspect),
        })
        if (selectedFocalLength !== null) {
          const fov = cameraViewportFov(selectedFocalLength, camera.aspect)
          if (cameraTransition) cameraTransition.toFov = fov
          else camera.fov = fov
        }
        camera.updateProjectionMatrix()
        activeRenderer.setSize(width, height, false)
      }
      const activeResizeObserver = new ResizeObserver(resize)
      resizeObserver = activeResizeObserver
      activeResizeObserver.observe(container)
      resize()

      const guideAxes = [
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
      ]
      const guideGroups = axisGuideRef.current?.querySelectorAll<SVGGElement>('[data-axis]')
      const inverseCameraRotation = new THREE.Quaternion()
      const guideDirection = new THREE.Vector3()
      const updateAxisGuide = () => {
        camera.getWorldQuaternion(inverseCameraRotation).invert()
        guideAxes.forEach((axis, index) => {
          const group = guideGroups?.[index]
          if (!group) return
          guideDirection.copy(axis).applyQuaternion(inverseCameraRotation)
          const x = 54 + guideDirection.x * 35
          const y = 54 - guideDirection.y * 35
          const line = group.querySelector('line')
          line?.setAttribute('x2', String(x))
          line?.setAttribute('y2', String(y))
          group.setAttribute('opacity', guideDirection.z < 0 ? '0.5' : '1')
        })
      }

      const unconstrainedPosition = new THREE.Vector3()
      const animate = () => {
        const now = performance.now()
        const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.05)
        previousFrameTime = now
        if (cameraTransition) {
          const elapsed = (performance.now() - cameraTransition.startedAt) / 850
          const progress = Math.min(elapsed, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          camera.position.lerpVectors(
            cameraTransition.fromPosition,
            cameraTransition.toPosition,
            eased,
          )
          camera.quaternion.slerpQuaternions(
            cameraTransition.fromRotation,
            cameraTransition.toRotation,
            eased,
          )
          controls.target.set(0, 0, -1).applyQuaternion(camera.quaternion)
            .multiplyScalar(THREE.MathUtils.lerp(
              cameraTransition.fromTargetDistance,
              cameraTransition.toTargetDistance,
              eased,
            ))
            .add(camera.position)
          camera.fov = THREE.MathUtils.lerp(
            cameraTransition.fromFov,
            cameraTransition.toFov,
            eased,
          )
          camera.updateProjectionMatrix()
          if (progress === 1) {
            cameraTransition = null
            controls.enabled = true
          }
        } else {
          controls.update()
          const forward = Number(flightKeys.has('KeyW')) - Number(flightKeys.has('KeyS'))
          const right = Number(flightKeys.has('KeyD')) - Number(flightKeys.has('KeyA'))
          const up = Number(flightKeys.has('KeyE')) - Number(flightKeys.has('KeyQ'))
          if (forward || right || up) {
            camera.getWorldDirection(flightForward)
            flightRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
            flightMovement.copy(flightForward).multiplyScalar(forward)
              .addScaledVector(flightRight, right)
            flightMovement.y += up
            const speed = flightKeys.has('ShiftLeft') || flightKeys.has('ShiftRight') ? 80 : 30
            flightMovement.normalize().multiplyScalar(speed * deltaSeconds)
            camera.position.add(flightMovement)
            controls.target.add(flightMovement)
            selectSection(null)
            setIsSeatView(false)
            setViewPreset('custom')
            setCameraViewLabel(null)
            setCameraLens(null)
            setCameraHorizontalFov(null)
            selectedFocalLength = null
          }
        }
        unconstrainedPosition.copy(camera.position)
        constrainCameraPosition(camera.position)
        unconstrainedPosition.sub(camera.position)
        controls.target.sub(unconstrainedPosition)
        updateAxisGuide()
        activeRenderer.render(scene, camera)
        frame = window.requestAnimationFrame(animate)
      }
      animate()

      return () => {
        window.cancelAnimationFrame(frame)
        activeResizeObserver.disconnect()
        activeRenderer.domElement.removeEventListener('pointerdown', onPointerDown)
        activeRenderer.domElement.removeEventListener('pointerup', onPointerUp)
        activeRenderer.domElement.removeEventListener('pointermove', onPointerMove)
        activeRenderer.domElement.removeEventListener('pointerleave', onPointerLeave)
        activeRenderer.domElement.removeEventListener('pointercancel', cancelPointerLook)
        activeRenderer.domElement.removeEventListener('lostpointercapture', cancelPointerLook)
        window.removeEventListener('blur', cancelPointerLook)
        cancelPointerLook()
        activeRenderer.domElement.removeEventListener('keydown', onFlightKeyDown)
        window.removeEventListener('keyup', onFlightKeyUp)
        activeRenderer.domElement.removeEventListener('blur', clearFlightKeys)
        window.removeEventListener('blur', clearFlightKeys)
        controls.removeEventListener('start', onOrbitStart)
        controls.dispose()
        disposeObject(scene)
        activeRenderer.dispose()
        activeRenderer.domElement.remove()
        sceneRef.current = null
        viewPresetRef.current = null
        stageSceneRef.current = null
      }
    } catch (caughtError) {
      console.error('Could not initialize the 3D venue.', caughtError)
      queueMicrotask(() => setError('The browser could not initialize the 3D venue.'))
      return () => {
        if (frame) window.cancelAnimationFrame(frame)
        resizeObserver?.disconnect()
        renderer?.dispose()
      }
    }
  }, [])

  useEffect(() => {
    stageSceneRef.current?.(stageScene)
  }, [stageScene])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const audience = createAudience(seats)
    scene.add(audience)
    return () => {
      scene.remove(audience)
      disposeObject(audience)
    }
  }, [seats])

  useEffect(() => {
    if (sceneRef.current) applyHouseLightLevel(sceneRef.current, houseLightLevel)
  }, [houseLightLevel])

  const toggleFullscreen = async () => {
    const container = containerRef.current
    if (!container) return

    try {
      setInteractionError(null)
      if (document.fullscreenElement === container) {
        await document.exitFullscreen()
      } else {
        await container.requestFullscreen()
      }
    } catch (caughtError) {
      console.error('Could not change the 3D venue fullscreen state.', caughtError)
      setInteractionError('Fullscreen mode is unavailable in this browser.')
    }
  }

  const controls = (
    <div className={`venue-controls-dock${isControlsOpen ? ' is-open' : ''}`} ref={controlsDockRef}>
      <button
        className="venue-controls-toggle"
        type="button"
        ref={controlsToggleRef}
        aria-label="View controls"
        aria-expanded={isControlsOpen}
        aria-controls={controlsId}
        onClick={() => setIsControlsOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6" />
        </svg>
        <span>View controls</span>
      </button>
      <div className="venue-3d-controls" id={controlsId} role="group" aria-label="3D view controls">
        <label>
          Camera
          <select aria-label="Camera angle" value={viewPreset} onChange={(event) => {
            const preset = event.target.value
            if (preset === 'overview' || preset === 'birds-eye' || preset === 'rear'
              || preset === 'stage' || preset === 'conductor') viewPresetRef.current?.(preset)
          }}>
            <option value="custom" disabled>Custom / seat view</option>
            <option value="overview">Overview</option>
            <option value="birds-eye">Bird's eye view</option>
            <option value="rear">Rear camera</option>
            <option value="stage">Stage DJI</option>
            <option value="conductor">Conductor phone</option>
          </select>
        </label>
        <SceneSelector scene={stageScene} onChange={onSceneChange} />
        <label className="house-light-control">
          House lights
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={houseLightLevel}
            aria-valuetext={`${houseLightLevel}%`}
            onChange={(event) => setHouseLightLevel(event.target.valueAsNumber)}
          />
          <output>{houseLightLevel}%</output>
        </label>
        <button type="button" onClick={toggleFullscreen} ref={fullscreenButtonRef}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  )
  const controlsTarget = fullscreenControlsHost ?? controlsHost

  return (
    <div
      className="venue-3d"
      ref={containerRef}
      role="region"
      aria-label={`Interactive 3D venue with ${audienceTotal.toLocaleString()} of ${totalCapacity.toLocaleString()} seats filled`}
    >
      {error ? (
        <div className="venue-3d-error" role="alert">{error}</div>
      ) : (
        <>
          {hoveredSection && (
            <div className="venue-section-label" role="status">{hoveredSection}</div>
          )}
          {controlsTarget ? createPortal(controls, controlsTarget) : controls}
          <div className={`venue-3d-help${isHelpOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              aria-expanded={isHelpOpen}
              aria-controls={helpId}
              onClick={() => setIsHelpOpen((current) => !current)}
            >
              Navigation help
            </button>
            <div className="venue-help-popover" id={helpId}>
              <p>Drag to look around · Scroll to zoom · Shift-drag or right-drag to pan</p>
              <p>Click the scene, then WASD to fly · Q/E down/up · Shift faster</p>
              <p>Click a chair for seat view or a camera for its framing.</p>
              <p>Hover stage sections to identify them.</p>
            </div>
          </div>
          {import.meta.env.DEV && (
          <div className="venue-axis-guide" role="img" aria-label="Venue coordinate arrows: X red, Y green, Z blue">
            <svg ref={axisGuideRef} viewBox="0 0 108 108" aria-hidden="true">
              <defs>
                {['x', 'y', 'z'].map((axis) => (
                  <marker
                    key={axis}
                    id={`${axisGuideId}-${axis}`}
                    className={`venue-axis-${axis}`}
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="8"
                    markerHeight="8"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
                  </marker>
                ))}
              </defs>
              {['+X', '-X', '+Y', '-Y', '+Z', '-Z'].map((axis) => (
                <g key={axis} data-axis={axis} className={`venue-axis-${axis[1].toLowerCase()}`}>
                  <line
                    x1="54" y1="54" x2="54" y2="54"
                    markerEnd={`url(#${axisGuideId}-${axis[1].toLowerCase()})`}
                  />
                </g>
              ))}
              <circle cx="54" cy="54" r="3" fill="#fff9e9" />
            </svg>
          </div>
          )}
          {isSeatView && <div className="venue-seat-view">View from seat</div>}
          {cameraViewLabel && <div className="venue-seat-view">View from {cameraViewLabel}</div>}
          {cameraViewLabel && cameraLens && (
            <div className="venue-camera-overlay" aria-label={`Approximate 16:9 framing, ${cameraHorizontalFov ? `${cameraHorizontalFov} degrees horizontal` : `${cameraLens}mm full-frame-equivalent lens`}`}>
              <div className="venue-camera-frame" style={{ width: frameSize.width, height: frameSize.height }}>
                <span>16:9 · {cameraHorizontalFov ? `${cameraHorizontalFov}° horizontal ultra-wide` : `${cameraLens}mm equivalent`} · approximate</span>
              </div>
            </div>
          )}
          {interactionError && (
            <div className="venue-3d-interaction-error" role="alert">
              {interactionError}
            </div>
          )}
        </>
      )}
    </div>
  )
}
