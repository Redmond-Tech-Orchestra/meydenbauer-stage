import { useEffect, useId, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
}

const roomHeight = 31
const seatPitch = 1.53
const rowPitch = 3.25
const sideRowAngle = THREE.MathUtils.degToRad(15)
const videoAspect = 16 / 9
const cameraViewportFov = (focalLength: number, viewportAspect: number) => {
  const frameHeightFraction = Math.min(1, viewportAspect / videoAspect)
  return THREE.MathUtils.radToDeg(2 * Math.atan((36 / videoAspect / (2 * focalLength)) / frameHeightFraction))
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
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        if (material instanceof THREE.MeshBasicMaterial && material.map) {
          material.map.dispose()
        }
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

const createStage = () => {
  const stage = new THREE.Group()
  stage.name = 'Tiered stage with orchestra seating'
  const tiers = [
    { width: 48, depth: 16, height: 6, z: -72 },
    { width: 48, depth: 8, height: 5, z: -60 },
    { width: 48, depth: 8, height: 4, z: -52 },
    { width: 54, depth: 8, height: 32 / 12, z: -44 },
  ]

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

  const harpStairs = new THREE.Group()
  harpStairs.name = 'Stage-left stairs to 5-foot tier (schematic)'
  harpStairs.position.set(24, 0, -60)
  harpStairs.userData.stairCount = 10
  const stairMaterial = new THREE.MeshStandardMaterial({ color: 0x68776a, roughness: 0.88 })
  for (let index = 0; index < 10; index++) {
    const height = 5 - index * 0.5
    const step = new THREE.Mesh(new THREE.BoxGeometry(1, height, 4), stairMaterial)
    step.position.set(index + 0.5, height / 2, 0)
    step.castShadow = true
    step.receiveShadow = true
    harpStairs.add(step)
  }
  stage.add(harpStairs)

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
    ;[-1, 1].forEach((side) => {
      const x = side * (tier.width / 2 - 0.12)
      if (side === 1 && tier.height === 5) {
        addRailing(x, -64, x, -62, tier.height)
        addRailing(x, -58, x, -56, tier.height)
      } else {
        addRailing(x, tier.z - tier.depth / 2, x, tier.z + tier.depth / 2, tier.height)
      }
    })
  })
  addRailing(-23.88, -79.88, 23.88, -79.88, 6)
  ;[-1, 1].forEach((side) => {
    addRailing(side * 23.88, -48.12, side * 26.88, -48.12, 32 / 12)
  })

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
  firstViolinXs.forEach((x) => {
    const chairX = x - 1 - frontStringsSetback
    const yaw = -Math.PI / 2
    ;[-43.3, -46.1].forEach((z) => {
      if (x === firstViolinXs[0] && z === -46.1) return
      addChair('First violins', 0x9a5b4a, chairX, 32 / 12, z - Math.abs(x) * 0.025, false, yaw)
    })
    const isSinglePlayer = x === firstViolinXs[0]
    const standZ = (isSinglePlayer ? -43.3 : -44.7) - Math.abs(x) * 0.025
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
    if (isSinglePlayer) stand.name = 'First violins individual music stand'
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
      index === 3,
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
        'Inputs 11-12: Stereo piano DI (88-key keyboard)', fullKeyboardWidth, 364 / 304.8, 141 / 304.8,
        fullKeyboardPosition.x, fullKeyboardPosition.z, 0x303b42, 4, keyboardYaw,
      )
      addKeyboard(
        'Inputs 13-14: Stereo keyboard DI (49-key keyboard)', compactKeyboardWidth, 7.19 / 12, 3.31 / 12,
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
  addHarp(14, -60.1)
  addHarp(19.6, -60.1)

  const brassPercussionSetback = 1.5
  const hornStageRightShift = 1
  addRow('Horns', 0xb58a49, [-16.25, -13.75, -11.25, -8.75].map((x) => x - hornStageRightShift), 6, -66.1 - brassPercussionSetback)
  addRow('Trumpets', 0xb9a45d, [-6.25, -3.75, -1.25, 1.25, 3.75], 6, -66.1 - brassPercussionSetback, false)
  addRow('Trombones', 0x9a6849, [6.25, 8.75, 11.25, 13.75], 6, -66.1 - brassPercussionSetback, false)
  addRow('Tuba', 0x765940, [16.25], 6, -66.1 - brassPercussionSetback, false)
  addRow('Horns', 0xb58a49, [-15, -12.5, -10].map((x) => x - hornStageRightShift), 6, -69.2 - brassPercussionSetback)
  const activePercussionStart = stage.children.length
  // Stage left is +X; percussion progresses toward stage right (-X).
  addBarPercussion('Glockenspiel', 3.2, 1.5, 17.9, -70.2, false, 0)
  addBarPercussion('Xylophone', 5, 2.3, 15.35, -72.5, true, Math.PI / 2)
  addPercussionTable(10.45, -69.4, true)
  addBarPercussion('Vibraphone', 6, 2.5, 8.6, -72.2, true, Math.PI / 2)
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
    / (stageRightPercussion.length + 1)
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
  addTimpani(29, 4, -77.6, 'Spare timpani')
  addTimpani(26, 0.8, -77.6, 'Spare timpani')
  addSnareDrum(-2.5, -77.6, 'Spare snare drum')

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
    'Inputs 1-2: Overheads - C414 spaced inward-facing pair',
    new THREE.Vector3(0, 32 / 12, -41.1), 8, new THREE.Vector3(),
    new THREE.Vector3(0, 5, -54), false, true,
  )
  ;['First violins', 'Second violins', 'Violas', 'Cellos', 'Basses'].forEach((section, index) => {
    if (section === 'Basses') {
      const players = stage.children.filter((object) => object.name === 'Basses')
        .sort((a, b) => a.position.distanceToSquared(conductorPosition) - b.position.distanceToSquared(conductorPosition))
        .slice(0, 2)
      if (players.length !== 2) throw new Error('Missing principal bass pair for input 7.')
      const midpoint = players[0].position.clone().add(players[1].position).multiplyScalar(0.5)
      addMicrophone(
        'Input 7: Principal bass pair - shared microphone', midpoint, 3.6,
        new THREE.Vector3(), midpoint.clone().add(new THREE.Vector3(-0.65, 2.7, 0)), true,
      )
      return
    }
    const musicStands = stage.children.filter((object) =>
      object.userData.orchestraSection === section && object.name.endsWith('music stand'),
    )
    const firstDeskStand = [...musicStands].sort((a, b) =>
      a.position.distanceToSquared(conductorPosition) - b.position.distanceToSquared(conductorPosition),
    )[0]
    if (!firstDeskStand) throw new Error(`Missing first-desk music stand for ${section}.`)
    const facingYaw: unknown = firstDeskStand.userData.facingYaw
    if (typeof facingYaw !== 'number' || !Number.isFinite(facingYaw)) {
      throw new Error(`Missing music-stand facing direction for ${section}.`)
    }
    const forward = new THREE.Vector3(-Math.sin(facingYaw), 0, -Math.cos(facingYaw))
    const base = firstDeskStand.position.clone().addScaledVector(forward, 0.7)
    const instrumentHeight = section === 'Cellos' ? 1.7 : section === 'Basses' ? 2.7 : 2.3
    const instrumentTarget = firstDeskStand.position.clone()
      .addScaledVector(forward, -0.65).add(new THREE.Vector3(0, instrumentHeight, 0))
    addMicrophone(
      `Input ${index + 3}: Principal ${section} - first-desk microphone`, base, 3.6,
      forward.clone().multiplyScalar(-0.7).setY(0.225),
      instrumentTarget, true,
    )
  })
  addMicrophone(
    'Input 8: 1st violin section - directional microphone',
    new THREE.Vector3(-11.5, 32 / 12, -41.7), 5.5,
    new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(-11.5, 4.5, -45),
  )
  const violinBlend = addMicrophone(
    'Input 9: 2nd violin section - shared violin omni (recording / cautious PA trial)',
    new THREE.Vector3(-11.3, 4, -48.8), 5.5,
    new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(-11.3, 5.8, -51),
  )
  violinBlend.userData.polarPattern = 'omnidirectional'
  const lowStringBlend = addMicrophone(
    'Input 10: Viola/cello section - shared omni (recording / cautious PA trial)',
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
      `Input ${index + 17}: Winds pair - ${section} high microphone`, base, 7,
      new THREE.Vector3(target.x - base.x, 0, target.z - base.z),
      target,
    )
  })
  stage.children.filter((object) => object.name === 'Concert harp').forEach((harp, index) => {
    const offset = new THREE.Vector3(0, 0, 0.9).applyQuaternion(harp.quaternion)
    addMicrophone(
      `Input ${index + 15}: Harp ${index + 1} close microphone`, harp.position.clone().add(offset), 3.2,
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
        ? center.clone().add(new THREE.Vector3(1.4, 0, 0.2))
        : center.clone().add(new THREE.Vector3(0, 0, 2.7))
    const boom = isHorns
      ? new THREE.Vector3(1, 0, 0.5)
      : isTuba
        ? new THREE.Vector3(-1.4, 0, 0.2)
        : new THREE.Vector3(0, 0, -0.8)
    // Instrument bodies are not modeled; bell targets are illustrative.
    const target = isHorns
      ? hornBellTarget
      : center.clone().add(new THREE.Vector3(0, isTuba ? 3.2 : 2.5, 0.4))
    addMicrophone(
      `Input ${index + 19}: ${isHorns ? 'Horns section microphone behind bells'
        : isTuba ? 'Tuba dedicated microphone above bell' : `${section} section microphone`}`,
      base, isTuba ? 4.5 : 4, boom, target,
    )
  })
  ;[
    { x: -20, targetX: -20 },
    { x: -7, targetX: -7 },
    { x: 6.2, targetX: 1 },
    { x: 13, targetX: 13 },
  ].forEach(({ x, targetX }, index) => {
    addMicrophone(
      `Input ${index + 23}: Percussion zone microphone ${index + 1}`,
      new THREE.Vector3(x, 6, -72), 6,
      new THREE.Vector3(0, 0, -0.5), new THREE.Vector3(targetX, 8.5, -74),
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
  stage.add(windsCameraRig)

  const sectionMaterialsForHover = new Map<string, THREE.MeshStandardMaterial>()
  const replacedMaterials = new Set<THREE.MeshStandardMaterial>()
  stage.children.forEach((object) => {
    if (!(object instanceof THREE.Group)) return
    const section = object.userData.orchestraSection
      ?? (object.name.endsWith('-inch timpano') ? 'Timpani' : object.name)
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
  stage.position.z = 2.25
  return stage
}

// Share the procedural scene without maintaining a second stage layout.
// oxlint-disable-next-line react/only-export-components
export const createStagePlan = () => {
  const stage = createStage()
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
      }
    })
    return items
  } finally {
    disposeObject(stage)
  }
}

const createRoom = () => {
  const room = new THREE.Group()
  room.name = '100 by 160 by 31 foot room'

  const outline = [
    [-37, -80], [50, -80], [50, 80], [-50, 80],
    [-50, -60], [-40, -60], [-40, -63], [-37, -63],
  ]
  const floorShape = new THREE.Shape()
  outline.forEach(([x, z], index) => {
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
  room.add(floor)

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8ebe6,
    depthWrite: false,
    opacity: 0.11,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const addWall = (x1: number, z1: number, x2: number, z2: number, bottom = 0, height = roomHeight) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(Math.hypot(x2 - x1, z2 - z1), height, 0.2),
      wallMaterial,
    )
    wall.position.set((x1 + x2) / 2, bottom + height / 2, (z1 + z2) / 2)
    wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1)
    room.add(wall)
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(wall.geometry),
      new THREE.LineBasicMaterial({ color: 0x6d7a73, transparent: true, opacity: 0.4 }),
    )
    edge.position.copy(wall.position)
    edge.rotation.copy(wall.rotation)
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
  room.add(garage)

  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x81968b, side: THREE.DoubleSide })
  const addDoorPair = (x: number, z: number) => {
    ;[x + 1.5, x + 4.5].forEach((centerX) => {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.96, 7, 0.12), doorMaterial)
      leaf.position.set(centerX, 3.5, z)
      leaf.name = 'Closed door leaf'
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

  const lift = new THREE.Group()
  lift.name = 'Extended scissor lift: 20-foot camera platform'
  lift.position.set(46, 0, -57.75)
  const liftMaterial = new THREE.MeshStandardMaterial({ color: 0xc89931, roughness: 0.6, metalness: 0.35 })
  const liftFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x303a36, roughness: 0.6, metalness: 0.5 })
  const addLiftBox = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), liftMaterial)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    lift.add(mesh)
  }
  addLiftBox(3.5, 0.7, 6, 0, 0.9, 0)
  ;[-1.65, 1.65].forEach((x) => {
    ;[-2.2, 2.2].forEach((z) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 16), liftFrameMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.6, z)
      lift.add(wheel)
    })
  })
  const addLiftArm = (start: THREE.Vector3, end: THREE.Vector3) => {
    const direction = end.clone().sub(start)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, direction.length(), 0.24), liftFrameMaterial)
    arm.position.copy(start).add(end).multiplyScalar(0.5)
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    arm.castShadow = true
    lift.add(arm)
  }
  for (let level = 0; level < 5; level++) {
    const bottom = 1.25 + level * 3.71
    const top = bottom + 3.71
    ;[-1.3, 1.3].forEach((x) => {
      addLiftArm(new THREE.Vector3(x, bottom, -2.4), new THREE.Vector3(x, top, 2.4))
      addLiftArm(new THREE.Vector3(x, bottom, 2.4), new THREE.Vector3(x, top, -2.4))
    })
  }
  addLiftBox(3.5, 0.2, 6, 0, 19.9, 0)
  ;[-1.65, 1.65].forEach((x) => {
    ;[-2.9, 0, 2.9].forEach((z) => addLiftBox(0.1, 3.5, 0.1, x, 21.75, z))
    ;[21.75, 23.5].forEach((y) => addLiftBox(0.1, 0.1, 5.8, x, y, 0))
  })
  ;[-2.9, 2.9].forEach((z) => {
    ;[21.75, 23.5].forEach((y) => addLiftBox(3.3, 0.1, 0.1, 0, y, z))
  })
  const liftCamera = new THREE.Group()
  liftCamera.name = 'Scissor lift camera aimed at stage'
  liftCamera.userData.cameraView = true
  liftCamera.userData.focalLength = 16
  liftCamera.position.set(-1, 22.5, 0)
  const stageTarget = new THREE.Vector3(0, 5, -57.75)
  liftCamera.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    stageTarget.clone().sub(lift.position).sub(liftCamera.position).normalize(),
  )
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1), liftFrameMaterial)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16), liftFrameMaterial)
  lens.rotation.x = Math.PI / 2
  lens.position.z = -0.7
  liftCamera.add(housing, lens)
  lift.add(liftCamera)
  addLiftArm(new THREE.Vector3(-1, 20, 0), liftCamera.position)
  room.add(lift)

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
    occupied: new THREE.MeshBasicMaterial({
      map: wheelchairTexture,
      side: THREE.DoubleSide,
      transparent: true,
    }),
    empty: new THREE.MeshBasicMaterial({
      map: wheelchairTexture,
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
    marker.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.yaw)
    marker.rotateX(-Math.PI / 2)
    marker.userData.seatView = { ...transform, id: seat.id }
    audience.add(marker)
  })

  return audience
}

type ViewPreset = 'overview' | 'birds-eye' | 'rear' | 'lift' | 'stage'
const cameraPresetNames = {
  rear: 'Rear tech camera',
  lift: 'Scissor lift camera aimed at stage',
  stage: 'Stage camera facing center winds',
}

export default function Venue3D({ seats, audienceTotal, totalCapacity }: Venue3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const axisGuideRef = useRef<SVGSVGElement>(null)
  const axisGuideId = useId()
  const helpId = useId()
  const sceneRef = useRef<THREE.Scene | null>(null)
  const viewPresetRef = useRef<((preset: ViewPreset) => void) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isSeatView, setIsSeatView] = useState(false)
  const [cameraViewLabel, setCameraViewLabel] = useState<string | null>(null)
  const [cameraLens, setCameraLens] = useState<number | null>(null)
  const [cameraHorizontalFov, setCameraHorizontalFov] = useState<number | null>(null)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [hoveredSection, setHoveredSection] = useState<string | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

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

      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400)
      const overviewPosition = new THREE.Vector3(77, 66, 118)
      const overviewTarget = new THREE.Vector3(0, 5, -10)
      camera.position.copy(overviewPosition)

      const activeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer = activeRenderer
      activeRenderer.outputColorSpace = THREE.SRGBColorSpace
      activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      activeRenderer.shadowMap.enabled = true
      activeRenderer.shadowMap.type = THREE.PCFShadowMap
      container.prepend(activeRenderer.domElement)

      const controls = new OrbitControls(camera, activeRenderer.domElement)
      controls.target.copy(overviewTarget)
      controls.enableDamping = true
      controls.dampingFactor = 0.07
      controls.maxDistance = 280
      controls.minDistance = 28
      controls.maxPolarAngle = Math.PI / 2.02

      scene.add(new THREE.HemisphereLight(0xffffff, 0x5d665f, 2.2))
      const keyLight = new THREE.DirectionalLight(0xfff3d6, 3.2)
      keyLight.position.set(-35, 55, 20)
      keyLight.castShadow = true
      keyLight.shadow.mapSize.set(2048, 2048)
      keyLight.shadow.camera.left = -70
      keyLight.shadow.camera.right = 70
      keyLight.shadow.camera.top = 90
      keyLight.shadow.camera.bottom = -90
      scene.add(keyLight)
      const stage = createStage()
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

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const highlightMaterials = new Map<string, Set<THREE.MeshStandardMaterial>>()
      stage.children.forEach((group) => {
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
          .addScaledVector(forward, cameraModel.userData.horizontalFov === 120 ? 0.14 : 0.95)
        const target = cameraModel.name === 'Rear tech camera'
          ? new THREE.Vector3(0, 5, -57.75)
          : lensPosition.clone().addScaledVector(forward, 60)
        selectSection(null)
        startCameraTransition(lensPosition, target, cameraViewportFov(focalLength, camera.aspect))
        setIsSeatView(false)
        setCameraViewLabel(cameraModel.name)
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
        setInteractionError(null)
        setIsSeatView(false)
        setCameraViewLabel(preset === 'birds-eye' ? "Bird's eye view" : null)
        setCameraLens(null)
        setCameraHorizontalFov(null)
        selectedFocalLength = null
        controls.maxPolarAngle = Math.PI / 2.02
        startCameraTransition(
          preset === 'birds-eye' ? new THREE.Vector3(0, 29, -24) : overviewPosition.clone(),
          preset === 'birds-eye' ? new THREE.Vector3(0, 4, -57.75) : overviewTarget.clone(),
          preset === 'birds-eye' ? 70 : 38,
        )
      }
      const onPointerMove = (event: PointerEvent) => {
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
      let pointerStart: { x: number; y: number } | null = null
      const onPointerDown = (event: PointerEvent) => {
        activeRenderer.domElement.focus({ preventScroll: true })
        if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY }
      }
      const onPointerUp = (event: PointerEvent) => {
        if (!pointerStart || event.button !== 0) return
        const movement = Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        )
        pointerStart = null
        if (movement > 6) return

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
          setCameraViewLabel(null)
          setCameraLens(null)
          setCameraHorizontalFov(null)
          selectedFocalLength = null
          controls.maxPolarAngle = Math.PI / 2.02
          break
        }
      }
      activeRenderer.domElement.addEventListener('pointerdown', onPointerDown)
      activeRenderer.domElement.addEventListener('pointerup', onPointerUp)
      activeRenderer.domElement.addEventListener('pointermove', onPointerMove)
      activeRenderer.domElement.addEventListener('pointerleave', onPointerLeave)
      activeRenderer.domElement.tabIndex = 0
      activeRenderer.domElement.setAttribute('aria-label', '3D venue navigation. WASD to fly, Q down, E up, Shift to move faster.')
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
            setCameraViewLabel(null)
            setCameraLens(null)
            setCameraHorizontalFov(null)
            selectedFocalLength = null
          }
        }
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
        activeRenderer.domElement.removeEventListener('keydown', onFlightKeyDown)
        window.removeEventListener('keyup', onFlightKeyUp)
        activeRenderer.domElement.removeEventListener('blur', clearFlightKeys)
        window.removeEventListener('blur', clearFlightKeys)
        controls.dispose()
        disposeObject(scene)
        activeRenderer.dispose()
        activeRenderer.domElement.remove()
        sceneRef.current = null
        viewPresetRef.current = null
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
    const scene = sceneRef.current
    if (!scene) return

    const audience = createAudience(seats)
    scene.add(audience)
    return () => {
      scene.remove(audience)
      disposeObject(audience)
    }
  }, [seats])

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
          <div className="venue-3d-controls">
            <button type="button" onClick={() => viewPresetRef.current?.('overview')}>
              Overview
            </button>
            <button type="button" onClick={() => viewPresetRef.current?.('birds-eye')}>
              Bird's eye view
            </button>
            <button type="button" onClick={() => viewPresetRef.current?.('rear')}>
              Rear camera
            </button>
            <button type="button" onClick={() => viewPresetRef.current?.('lift')}>
              Lift camera
            </button>
            <button type="button" onClick={() => viewPresetRef.current?.('stage')}>
              Stage DJI
            </button>
            <button type="button" onClick={toggleFullscreen}>
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
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
              <p>Drag to orbit · Scroll to zoom · Right-drag to pan</p>
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
