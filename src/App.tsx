import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import './App.css'
import type { VenueSeat } from './Venue3D'

const Venue3D = lazy(() => import('./Venue3D'))
const StagePlan = lazy(() => import('./StagePlan'))

type Zone = 'Front' | 'Middle' | 'Rear'
type PreviewMode = '2d' | 'stage' | '3d'
const viewRoutes: { mode: PreviewMode; path: string; label: string }[] = [
  { mode: '2d', path: '/plan', label: 'Auditorium plan' },
  { mode: 'stage', path: '/stage', label: 'Production stage plan' },
  { mode: '3d', path: '/venue', label: '3D venue' },
]
const previewModeFromUrl = (): PreviewMode =>
  viewRoutes.find((route) => `#${route.path}` === window.location.hash)?.mode ?? '2d'

type Position = 'Left' | 'Center' | 'Right'
type AdmissionCategory = 'premium' | 'reserved' | 'general' | 'accessible'
type AudienceCounts = Record<AdmissionCategory, number>
type ControlsPanelPreferences = {
  desktop: boolean
  mobile: boolean
}

type SeatingSection = {
  id: string
  zone: Zone
  position: Position
  rows: number
  columns: number
}

type SeatKind = 'regular' | 'wheelchair' | 'companion'
type SeatPlacement = {
  id: string
  kind: SeatKind
  column: number
  span: 1 | 2
}

const zones: Zone[] = ['Front', 'Middle', 'Rear']
const positions: Position[] = ['Left', 'Center', 'Right']
const wheelchairSymbol = '♿︎'
const admissionCategories: AdmissionCategory[] = ['premium', 'reserved', 'general', 'accessible']
const admissionCategoryLabels: Record<AdmissionCategory, string> = {
  premium: 'Premium',
  reserved: 'Premium Lite',
  general: 'General admission',
  accessible: 'ADA',
}
const defaultAttendanceRates: AudienceCounts = {
  premium: 80,
  reserved: 80,
  general: 45,
  accessible: 45,
}
const ticketSalesStorageKey = 'meydenbauer-stage:ticket-sales:v1'
const controlsPanelStorageKey = 'meydenbauer-stage:controls-panel:v1'
const emptyTicketSales: AudienceCounts = {
  premium: 0,
  reserved: 0,
  general: 0,
  accessible: 0,
}
const defaultControlsPanelPreferences: ControlsPanelPreferences = {
  desktop: true,
  mobile: false,
}
const minColumns = 1
const maxColumns = 18
const maxColumnsPerRow = 45
const premiumLiteVolunteerCount = 25
const maxRowsPerAxis = 26
const maxRowsPerSection = maxRowsPerAxis - 2
const rowDonorByZone: Record<Zone, Zone> = {
  Front: 'Middle',
  Middle: 'Rear',
  Rear: 'Middle',
}

const createDefaultSections = (): SeatingSection[] =>
  zones.flatMap((zone) =>
    positions.map((position) => ({
      id: `${zone}-${position}`.toLowerCase(),
      zone,
      position,
      rows: zone === 'Front'
        ? 7
        : zone === 'Middle'
          ? 7
          : position === 'Center' ? 11 : 12,
      columns: position === 'Center' ? 17 : position === 'Right' ? 13 : 14,
    })),
  )

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const isAccessibleBoundaryRow = (section: SeatingSection, row: number) =>
  (section.zone === 'Middle' && row === section.rows - 1)
  || (section.zone === 'Rear' && row === 0)

const isRearLeftClearanceRow = (section: SeatingSection, row: number) =>
  section.zone === 'Rear' && section.position === 'Left' && row === section.rows - 1

const seatPlacementsForRow = (section: SeatingSection, row: number): SeatPlacement[] => {
  let placements: SeatPlacement[]

  if (!isAccessibleBoundaryRow(section, row)) {
    placements = Array.from({ length: section.columns }, (_, column) => ({
      id: String(column),
      kind: 'regular' as const,
      column,
      span: 1 as const,
    }))
  } else {
    const moduleCount = Math.floor(section.columns / 3)
    const leadingRegularSeats = Math.floor((section.columns % 3) / 2)
    placements = []
    let column = 0

    for (; column < leadingRegularSeats; column += 1) {
      placements.push({ id: `regular-${column}`, kind: 'regular', column, span: 1 })
    }

    for (let module = 0; module < moduleCount; module += 1) {
      placements.push({ id: `ada-${module}`, kind: 'wheelchair', column, span: 2 })
      column += 2
      placements.push({ id: `companion-${module}`, kind: 'companion', column, span: 1 })
      column += 1
    }

    for (; column < section.columns; column += 1) {
      placements.push({ id: `regular-${column}`, kind: 'regular', column, span: 1 })
    }
  }

  return isRearLeftClearanceRow(section, row) ? placements.slice(0, -1) : placements
}

const sectionCapacity = (section: SeatingSection) =>
  Array.from({ length: section.rows }, (_, row) => seatPlacementsForRow(section, row).length)
    .reduce((total, rowCapacity) => total + rowCapacity, 0)

const wheelchairCapacity = (section: SeatingSection) =>
  Array.from({ length: section.rows }, (_, row) =>
    seatPlacementsForRow(section, row).filter((seat) => seat.kind === 'wheelchair').length)
  .reduce((total, rowCapacity) => total + rowCapacity, 0)

const rowLabel = (index: number) => {
  let value = index + 1
  let label = ''

  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + value % 26) + label
    value = Math.floor(value / 26)
  }

  return label
}

const isDefaultPremiumSection = (section: SeatingSection) =>
  section.zone === 'Middle' || (section.zone === 'Front' && section.position === 'Center')

const createDefaultPremiumSections = () => new Set(
  createDefaultSections().filter(isDefaultPremiumSection).map((section) => section.id),
)

const createDefaultReserveSections = () => new Set(['front-left', 'front-right'])

const hasTechBoothClearance = (section: SeatingSection) =>
  section.zone === 'Rear' && section.position === 'Center'

const admissionLabel = (
  section: SeatingSection,
  premiumSectionIds: Set<string>,
  reserveSectionIds: Set<string>,
) => {
  if (premiumSectionIds.has(section.id)) return 'Premium'
  if (reserveSectionIds.has(section.id)) return 'Premium Lite'
  return 'General Admission'
}

const admissionCategory = (
  section: SeatingSection,
  premiumSectionIds: Set<string>,
  reserveSectionIds: Set<string>,
): AdmissionCategory => {
  if (premiumSectionIds.has(section.id)) return 'premium'
  if (reserveSectionIds.has(section.id)) return 'reserved'
  return 'general'
}

const seatAdmissionCategory = (
  section: SeatingSection,
  seat: SeatPlacement,
  premiumSectionIds: Set<string>,
  reserveSectionIds: Set<string>,
): AdmissionCategory => seat.kind === 'wheelchair'
  ? 'accessible'
  : admissionCategory(section, premiumSectionIds, reserveSectionIds)

const seededRandom = (seed: number) => {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let result = value
    result = Math.imul(result ^ result >>> 15, result | 1)
    result ^= result + Math.imul(result ^ result >>> 7, result | 61)
    return ((result ^ result >>> 14) >>> 0) / 4294967296
  }
}

const loadTicketSales = (): AudienceCounts => {
  try {
    const stored = window.localStorage.getItem(ticketSalesStorageKey)
    if (!stored) return emptyTicketSales

    const values: unknown = JSON.parse(stored)
    const storedCategories = ['premium', 'reserved', 'general'] as const
    const accessibleValue = typeof values === 'object' && values !== null
      ? (values as Record<string, unknown>).accessible
      : undefined
    if (
      typeof values !== 'object'
      || values === null
      || !storedCategories.every((category) => {
        const value = (values as Record<string, unknown>)[category]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0
      })
      || (
        accessibleValue !== undefined
        && (typeof accessibleValue !== 'number'
          || !Number.isFinite(accessibleValue)
          || accessibleValue < 0)
      )
    ) {
      console.error(`Invalid ticket sales data in localStorage key "${ticketSalesStorageKey}".`)
      return emptyTicketSales
    }

    const ticketSales = values as Record<string, number>
    return {
      premium: Math.round(ticketSales.premium),
      reserved: Math.round(ticketSales.reserved),
      general: Math.round(ticketSales.general),
      accessible: typeof accessibleValue === 'number' ? Math.round(accessibleValue) : 0,
    }
  } catch (error) {
    console.error(
      `Could not read ticket sales from localStorage key "${ticketSalesStorageKey}".`,
      error,
    )
    return emptyTicketSales
  }
}

const loadControlsPanelPreferences = (): ControlsPanelPreferences => {
  try {
    const stored = window.localStorage.getItem(controlsPanelStorageKey)
    if (!stored) return defaultControlsPanelPreferences

    const values: unknown = JSON.parse(stored)
    if (
      typeof values !== 'object'
      || values === null
      || typeof (values as Record<string, unknown>).desktop !== 'boolean'
      || typeof (values as Record<string, unknown>).mobile !== 'boolean'
    ) {
      console.error(
        `Invalid controls panel data in localStorage key "${controlsPanelStorageKey}".`,
      )
      return defaultControlsPanelPreferences
    }

    return values as ControlsPanelPreferences
  } catch (error) {
    console.error(
      `Could not read controls panel state from localStorage key "${controlsPanelStorageKey}".`,
      error,
    )
    return defaultControlsPanelPreferences
  }
}

const occupiedSeatsFor = (
  sections: SeatingSection[],
  premiumSectionIds: Set<string>,
  reserveSectionIds: Set<string>,
  audienceCounts: AudienceCounts,
  seed: number,
) => {
  const occupied = new Set<string>()

  admissionCategories.forEach((category, categoryIndex) => {
    const random = seededRandom(seed + categoryIndex * 10_007)
    const weightedSeats = sections.flatMap((section) => {
      const sectionWeight = section.position === 'Center' ? 2.4 : 1
      const rowCenter = (section.columns - 1) / 2
      const deviation = Math.max(section.columns * 0.24, 1)

      return Array.from({ length: section.rows }, (_, row) =>
        seatPlacementsForRow(section, row)
          .filter((seat) =>
            seatAdmissionCategory(
              section,
              seat,
              premiumSectionIds,
              reserveSectionIds,
            ) === category)
          .map((seat) => {
            const seatCenter = seat.column + (seat.span - 1) / 2
            const distance = (seatCenter - rowCenter) / deviation
            const rowWeight = 0.12 + Math.exp(-0.5 * distance * distance)
            const weight = sectionWeight * rowWeight

            return {
              id: `${section.id}-${row}-${seat.id}`,
              priority: -Math.log(Math.max(random(), Number.EPSILON)) / weight,
            }
          }),
      ).flat()
    })
    const capacity = weightedSeats.length
    const target = clamp(audienceCounts[category], 0, capacity)

    weightedSeats
      .sort((left, right) => left.priority - right.priority)
      .slice(0, target)
      .forEach((seat) => occupied.add(seat.id))
  })

  return occupied
}

const maxRowsForPosition = (position: Position) =>
  position === 'Center' ? maxRowsPerAxis - 1 : maxRowsPerAxis

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={locked ? 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3 7.5h10v7H3z' : 'M11.5 7V5a3.5 3.5 0 0 0-6.7-1.4M3 7.5h10v7H3z'} />
    </svg>
  )
}

type DimensionInputProps = {
  label: string
  value: number
  min?: number
  max: number
  onChange: (value: number) => void
  onMax: () => void
  onIncrement?: () => void
}

function DimensionInput({ label, value, min = 1, max, onChange, onMax, onIncrement }: DimensionInputProps) {
  const increment = () => {
    if (onIncrement) {
      onIncrement()
      return
    }
    if (value >= max) {
      onMax()
      return
    }
    onChange(value + 1)
  }

  return (
    <div className="number-control">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' && value >= max) {
            event.preventDefault()
            onMax()
          }
        }}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          if (nextValue > max) onMax()
          onChange(nextValue)
        }}
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={increment}>+</button>
    </div>
  )
}

function App() {
  const [sections, setSections] = useState(createDefaultSections)
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null)
  const [rowLocks, setRowLocks] = useState<Record<Zone, boolean>>({
    Front: true,
    Middle: true,
    Rear: true,
  })
  const [columnLocks, setColumnLocks] = useState<Record<Position, boolean>>({
    Left: true,
    Center: true,
    Right: true,
  })
  const [premiumSectionIds, setPremiumSectionIds] = useState(createDefaultPremiumSections)
  const [reserveSectionIds, setReserveSectionIds] = useState(createDefaultReserveSections)
  const [ticketSales, setTicketSales] = useState<AudienceCounts>(loadTicketSales)
  const [attendanceRates, setAttendanceRates] = useState<AudienceCounts>(defaultAttendanceRates)
  const [audienceViewMode, setAudienceViewMode] = useState<'sales' | 'full'>('sales')
  const [audienceSeed, setAudienceSeed] = useState(1)
  const [showSectionLabels, setShowSectionLabels] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(previewModeFromUrl)
  const [isLargeScreen, setIsLargeScreen] = useState(
    () => window.matchMedia('(min-width: 1251px)').matches,
  )
  const [controlsPanelPreferences, setControlsPanelPreferences] =
    useState<ControlsPanelPreferences>(loadControlsPanelPreferences)
  const [toast, setToast] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const auditoriumRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const isControlsPanelOpen = isLargeScreen
    ? controlsPanelPreferences.desktop
    : controlsPanelPreferences.mobile

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    const syncRoute = () => setPreviewMode(previewModeFromUrl())
    if (!viewRoutes.some((route) => `#${route.path}` === window.location.hash)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/plan`)
    }
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    const largeScreen = window.matchMedia('(min-width: 1251px)')
    const syncPanelVisibility = (event: MediaQueryListEvent) => {
      setIsLargeScreen(event.matches)
    }
    largeScreen.addEventListener('change', syncPanelVisibility)
    return () => largeScreen.removeEventListener('change', syncPanelVisibility)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ticketSalesStorageKey, JSON.stringify(ticketSales))
    } catch (error) {
      console.error(
        `Could not save ticket sales to localStorage key "${ticketSalesStorageKey}".`,
        error,
      )
    }
  }, [ticketSales])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        controlsPanelStorageKey,
        JSON.stringify(controlsPanelPreferences),
      )
    } catch (error) {
      console.error(
        `Could not save controls panel state to localStorage key "${controlsPanelStorageKey}".`,
        error,
      )
    }
  }, [controlsPanelPreferences])

  const totalSeats = useMemo(
    () => sections.reduce((total, section) => total + sectionCapacity(section), 0),
    [sections],
  )
  const wheelchairSpaces = useMemo(
    () => sections.reduce((total, section) => total + wheelchairCapacity(section), 0),
    [sections],
  )
  const premiumSections = useMemo(
    () => sections.filter((section) => premiumSectionIds.has(section.id)),
    [premiumSectionIds, sections],
  )
  const reserveSections = useMemo(
    () => sections.filter((section) => reserveSectionIds.has(section.id)),
    [reserveSectionIds, sections],
  )
  const premiumSeats = useMemo(
    () => premiumSections.reduce(
      (total, section) => total + sectionCapacity(section) - wheelchairCapacity(section),
      0,
    ),
    [premiumSections],
  )
  const reserveSeats = useMemo(
    () => reserveSections.reduce(
      (total, section) => total + sectionCapacity(section) - wheelchairCapacity(section),
      0,
    ),
    [reserveSections],
  )
  const generalSeats = totalSeats - premiumSeats - reserveSeats - wheelchairSpaces
  const categoryCapacities = useMemo<AudienceCounts>(() => ({
    premium: premiumSeats,
    reserved: reserveSeats,
    general: generalSeats,
    accessible: wheelchairSpaces,
  }), [generalSeats, premiumSeats, reserveSeats, wheelchairSpaces])
  const projectedAudienceCounts = useMemo<AudienceCounts>(() => ({
    premium: Math.min(
      Math.round(ticketSales.premium * attendanceRates.premium / 100),
      premiumSeats,
    ),
    reserved: Math.min(
      Math.round(ticketSales.reserved * attendanceRates.reserved / 100)
        + premiumLiteVolunteerCount,
      reserveSeats,
    ),
    general: Math.min(
      Math.round(ticketSales.general * attendanceRates.general / 100),
      generalSeats,
    ),
    accessible: Math.min(
      Math.round((ticketSales.accessible ?? 0) * attendanceRates.accessible / 100),
      wheelchairSpaces,
    ),
  }), [
    attendanceRates,
    generalSeats,
    premiumSeats,
    reserveSeats,
    ticketSales,
    wheelchairSpaces,
  ])
  const effectiveAudienceCounts = previewMode === '3d' || audienceViewMode === 'full'
    ? categoryCapacities
    : projectedAudienceCounts
  const occupiedSeatIds = useMemo(
    () => occupiedSeatsFor(
      sections,
      premiumSectionIds,
      reserveSectionIds,
      effectiveAudienceCounts,
      audienceSeed,
    ),
    [
      audienceSeed,
      effectiveAudienceCounts,
      premiumSectionIds,
      reserveSectionIds,
      sections,
    ],
  )
  const venueSeats = useMemo<VenueSeat[]>(
    () => sections.flatMap((section) =>
      Array.from({ length: section.rows }, (_, row) =>
        seatPlacementsForRow(section, row).map((seat) => {
          const id = `${section.id}-${row}-${seat.id}`
          return {
            id,
            zone: section.zone,
            position: section.position,
            row,
            column: seat.column,
            columns: section.columns,
            span: seat.span,
            kind: seat.kind,
            category: seatAdmissionCategory(
              section,
              seat,
              premiumSectionIds,
              reserveSectionIds,
            ),
            occupied: occupiedSeatIds.has(id),
          }
        }),
      ).flat(),
    ),
    [occupiedSeatIds, premiumSectionIds, reserveSectionIds, sections],
  )
  const audienceTotal = admissionCategories.reduce(
    (total, category) =>
      total + Math.min(effectiveAudienceCounts[category], categoryCapacities[category]),
    0,
  )

  const updateSection = (
    id: string,
    dimension: 'rows' | 'columns',
    value: number,
  ) => {
    setSections((current) => {
      const source = current.find((section) => section.id === id)
      if (!source) return current

      const nextValue = clamp(
        value || 1,
        dimension === 'rows' ? 1 : minColumns,
        dimension === 'rows' ? maxRowsPerSection : maxColumns,
      )

      return current.map((section) => {
        const isLinked = dimension === 'rows'
          ? rowLocks[source.zone] && section.zone === source.zone
          : columnLocks[source.position] && section.position === source.position

        if (section.id === id) return { ...section, [dimension]: nextValue }
        if (!isLinked) return section

        const linkedValue = dimension === 'rows'
          ? clamp(section.rows + nextValue - source.rows, 1, maxRowsPerSection)
          : nextValue
        return { ...section, [dimension]: linkedValue }
      })
    })
  }

  const toggleRowLock = (zone: Zone) => {
    const willLock = !rowLocks[zone]
    setRowLocks((current) => ({ ...current, [zone]: willLock }))
    if (willLock) {
      setSections((current) => {
        const rows = current.find((section) => section.zone === zone)?.rows ?? 1
        return current.map((section) => section.zone === zone
          ? {
              ...section,
              rows: zone === 'Rear' && section.position === 'Center'
                ? Math.max(1, rows - 1)
                : rows,
            }
          : section)
      })
    }
  }

  const toggleColumnLock = (position: Position) => {
    const willLock = !columnLocks[position]
    setColumnLocks((current) => ({ ...current, [position]: willLock }))
    if (willLock) {
      setSections((current) => {
        const columns = current.find((section) => section.position === position)?.columns ?? 1
        return current.map((section) => section.position === position
          ? { ...section, columns }
          : section)
      })
    }
  }

  const updateTicketSales = (category: AdmissionCategory, value: number) => {
    setTicketSales((current) => ({
      ...current,
      [category]: Math.max(0, Number.isFinite(value) ? Math.round(value) : 0),
    }))
  }

  const updateAttendanceRate = (category: AdmissionCategory, value: number) => {
    setAttendanceRates((current) => ({
      ...current,
      [category]: clamp(Number.isFinite(value) ? value : 0, 0, 100),
    }))
  }

  const exportPlan = async () => {
    const auditorium = auditoriumRef.current
    if (!auditorium) {
      showToast('The auditorium plan is not ready to export.')
      return
    }

    setIsExporting(true)
    try {
      const padding = 30
      const pixelRatio = 3
      const auditoriumRect = auditorium.getBoundingClientRect()
      const width = auditoriumRect.width
      const height = auditoriumRect.height
      const exportWidth = width + padding * 2
      const exportHeight = height + padding * 2
      const canvas = document.createElement('canvas')
      canvas.width = exportWidth * pixelRatio
      canvas.height = exportHeight * pixelRatio
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The browser could not initialize PNG rendering.')

      const relativeRect = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.left - auditoriumRect.left,
          y: rect.top - auditoriumRect.top,
          width: rect.width,
          height: rect.height,
        }
      }
      const roundedRect = (x: number, y: number, rectWidth: number, rectHeight: number, radius: number) => {
        context.beginPath()
        context.roundRect(x, y, rectWidth, rectHeight, radius)
      }

      context.scale(pixelRatio, pixelRatio)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, exportWidth, exportHeight)
      context.translate(padding, padding)

      context.fillStyle = '#fbfcfa'
      context.fillRect(0, 0, width, height)

      const drawFixture = (selector: string, title: string, subtitle: string) => {
        const element = auditorium.querySelector(selector)
        if (!element) return
        const rect = relativeRect(element)
        const computed = getComputedStyle(element)
        context.fillStyle = computed.backgroundColor
        if (selector === '.stage') {
          const sideInset = rect.width * 3 / 54
          const apronTop = rect.y + rect.height * 32 / 40
          context.beginPath()
          context.moveTo(rect.x + sideInset, rect.y)
          context.lineTo(rect.x + rect.width - sideInset, rect.y)
          context.lineTo(rect.x + rect.width - sideInset, apronTop)
          context.lineTo(rect.x + rect.width, apronTop)
          context.lineTo(rect.x + rect.width, rect.y + rect.height)
          context.lineTo(rect.x, rect.y + rect.height)
          context.lineTo(rect.x, apronTop)
          context.lineTo(rect.x + sideInset, apronTop)
          context.closePath()
          context.fill()
        } else {
          context.fillRect(rect.x, rect.y, rect.width, rect.height)
        }
        context.fillStyle = computed.color
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = `700 ${computed.fontSize} ${computed.fontFamily}`
        context.fillText(title, rect.x + rect.width / 2, rect.y + rect.height / 2 - (subtitle ? 7 : 0))
        const small = element.querySelector('small')
        const smallStyle = small ? getComputedStyle(small) : computed
        context.fillStyle = smallStyle.color
        context.font = `700 ${smallStyle.fontSize} ${smallStyle.fontFamily}`
        context.fillText(subtitle, rect.x + rect.width / 2, rect.y + rect.height / 2 + 13)
      }
      drawFixture('.stage', 'STAGE', '')

      auditorium.querySelectorAll<HTMLElement>('.seat, .wheelchair-space').forEach((seat) => {
        const rect = relativeRect(seat)
        const row = seat.closest('.seat-row')
        const transform = row ? getComputedStyle(row).transform : 'none'
        const matrix = transform === 'none' ? null : new DOMMatrix(transform)
        const angle = matrix ? Math.atan2(matrix.b, matrix.a) : 0
        const computed = getComputedStyle(seat)
        const seatWidth = seat.offsetWidth
        const seatHeight = seat.offsetHeight
        const isWheelchair = seat.classList.contains('wheelchair-space')
        const seatLabel = seat.textContent?.trim()
        context.save()
        context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
        context.rotate(angle)
        if (isWheelchair) {
          context.globalAlpha = Number.parseFloat(computed.opacity)
          context.fillStyle = computed.color
          context.font = `800 ${computed.fontSize} ${computed.fontFamily}`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(seatLabel ?? wheelchairSymbol, 0, 0)
        } else {
          roundedRect(-seatWidth / 2, -seatHeight / 2, seatWidth, seatHeight, seatWidth / 2)
          context.fillStyle = computed.backgroundColor
          context.fill()
          context.strokeStyle = computed.borderTopColor
          context.lineWidth = 1
          context.stroke()
          if (seatLabel) {
            context.fillStyle = computed.color
            context.font = `800 ${computed.fontSize} ${computed.fontFamily}`
            context.textAlign = 'center'
            context.textBaseline = 'middle'
            context.fillText(seatLabel, 0, 0)
          }
        }
        context.restore()
      })

      auditorium.querySelectorAll<HTMLElement>('.row-label').forEach((label) => {
        const rect = relativeRect(label)
        const computed = getComputedStyle(label)
        context.fillStyle = computed.color
        context.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(
          label.textContent?.trim() ?? '',
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        )
      })

      auditorium.querySelectorAll<HTMLElement>('.section-label').forEach((label) => {
        const rect = relativeRect(label)
        const computed = getComputedStyle(label)
        roundedRect(rect.x, rect.y, rect.width, rect.height, 3)
        context.fillStyle = computed.backgroundColor
        context.fill()
        context.strokeStyle = computed.borderTopColor
        context.lineWidth = 1
        context.stroke()
        context.fillStyle = computed.borderBottomColor
        context.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2)

        const strong = label.querySelector('strong')
        if (!strong) return
        const textStyle = getComputedStyle(strong)
        const lines = strong.textContent?.trim() === 'General Admission'
          ? ['GENERAL', 'ADMISSION']
          : [strong.textContent?.trim().toUpperCase() ?? '']
        const fontSize = Number.parseFloat(textStyle.fontSize)
        const lineHeight = fontSize * 1.05
        context.fillStyle = textStyle.color
        context.font = `${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        lines.forEach((line, index) => {
          const offset = (index - (lines.length - 1) / 2) * lineHeight
          context.fillText(line, rect.x + rect.width / 2, rect.y + rect.height / 2 + offset)
        })
      })

      drawFixture('.tech-booth', 'TECH BOOTH', 'Tech + camera: 24′ × 8′')
      drawFixture('.camera-position', 'CAMERA', '')

      const roomDetails = auditorium.querySelector('.room-plan-details')
      if (!roomDetails) throw new Error('Room details are not ready to export.')
      const exportRoomDetails = roomDetails.cloneNode(true) as SVGSVGElement
      exportRoomDetails.setAttribute('viewBox', '0 0 100 164')
      exportRoomDetails.setAttribute('width', '100')
      exportRoomDetails.setAttribute('height', '164')
      const roomImage = new Image()
      roomImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        new XMLSerializer().serializeToString(exportRoomDetails),
      )}`
      await roomImage.decode()
      context.drawImage(roomImage, 0, 0, width, height * 164 / 160)
      context.fillStyle = '#85918b'
      context.font = '700 8px Inter, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('100′', width / 2, -12)
      context.save()
      context.translate(width + 18, height / 2)
      context.rotate(Math.PI / 2)
      context.fillText('160′', 0, 0)
      context.restore()

      const download = document.createElement('a')
      download.download = 'meydenbauer-seating-plan.png'
      download.href = canvas.toDataURL('image/png')
      download.style.display = 'none'
      document.body.append(download)
      download.click()
      download.remove()
    } catch (error) {
      console.error('Failed to export auditorium plan as PNG.', error)
      showToast('Could not export the PNG. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const togglePremiumSection = (id: string) => {
    setPremiumSectionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        setReserveSectionIds((reserve) => {
          const updated = new Set(reserve)
          updated.delete(id)
          return updated
        })
      }
      return next
    })
  }

  const toggleReserveSection = (id: string) => {
    setReserveSectionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        setPremiumSectionIds((premium) => {
          const updated = new Set(premium)
          updated.delete(id)
          return updated
        })
      }
      return next
    })
  }

  const showMaxToast = (dimension: string, maximum: number) => {
    showToast(`${dimension} are at the fitted maximum of ${maximum}.`)
  }

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }

  const incrementRows = (id: string) => {
    const source = sections.find((section) => section.id === id)
    if (!source) return

    const donorZone = rowDonorByZone[source.zone]
    const linkedTransfer = rowLocks[source.zone] || rowLocks[donorZone]
    const targetPositions = linkedTransfer ? positions : [source.position]
    const blocked = targetPositions.some((position) => {
      const total = sections
        .filter((section) => section.position === position)
        .reduce((sum, section) => sum + section.rows, 0)
      const donor = sections.find(
        (section) => section.zone === donorZone && section.position === position,
      )
      return total >= maxRowsForPosition(position) && (!donor || donor.rows <= 1)
    })

    if (blocked) {
      showMaxToast(`${source.zone} rows`, maxRowsPerSection)
      return
    }

    const willTransfer = targetPositions.some((position) =>
      sections
        .filter((section) => section.position === position)
        .reduce((sum, section) => sum + section.rows, 0) >= maxRowsForPosition(position),
    )

    setSections((current) => {
      const next = current.map((section) => ({ ...section }))

      targetPositions.forEach((position) => {
        const target = next.find(
          (section) => section.zone === source.zone && section.position === position,
        )
        const donor = next.find(
          (section) => section.zone === donorZone && section.position === position,
        )
        if (!target || !donor) return

        const total = next
          .filter((section) => section.position === position)
          .reduce((sum, section) => sum + section.rows, 0)
        if (total >= maxRowsForPosition(position)) {
          donor.rows -= 1
        }
        target.rows += 1
      })

      return next
    })

    if (willTransfer) {
      showToast(`Moved one row from ${donorZone} to ${source.zone}.`)
    }
  }

  const incrementColumns = (id: string) => {
    const source = sections.find((section) => section.id === id)
    if (!source) return

    const sameZone = sections.filter((section) => section.zone === source.zone)
    const donorPosition: Position = source.position === 'Left'
      ? 'Center'
      : source.position === 'Right'
        ? 'Center'
        : (sameZone.find((section) => section.position === 'Left')?.columns ?? 1)
            > (sameZone.find((section) => section.position === 'Right')?.columns ?? 1)
          ? 'Left'
          : 'Right'
    const linkedTransfer = columnLocks[source.position] || columnLocks[donorPosition]
    const targetZones = linkedTransfer ? zones : [source.zone]
    const blocked = source.columns >= maxColumns || targetZones.some((zone) => {
      const donor = sections.find(
        (section) => section.zone === zone && section.position === donorPosition,
      )
      return !donor || donor.columns <= minColumns
    })

    if (blocked) {
      showMaxToast(`${source.position} columns`, maxColumns)
      return
    }

    const willTransfer = targetZones.some((zone) =>
      sections
        .filter((section) => section.zone === zone)
        .reduce((sum, section) => sum + section.columns, 0) >= maxColumnsPerRow,
    )

    setSections((current) => {
      const next = current.map((section) => ({ ...section }))

      targetZones.forEach((zone) => {
        const target = next.find(
          (section) => section.zone === zone && section.position === source.position,
        )
        const donor = next.find(
          (section) => section.zone === zone && section.position === donorPosition,
        )
        if (!target || !donor) return

        const total = next
          .filter((section) => section.zone === zone)
          .reduce((sum, section) => sum + section.columns, 0)
        if (total >= maxColumnsPerRow) donor.columns -= 1
        target.columns += 1
      })

      return next
    })

    if (willTransfer) {
      showToast(`Moved one column from ${donorPosition} to ${source.position}.`)
    }
  }

  return (
    <main className="app-shell">
      <nav className="view-nav" aria-label="Planner views">
        <div className="preview-mode-toggle">
          {viewRoutes.map((route) => (
            <a
              key={route.mode}
              id={`view-nav-${route.mode}`}
              href={`#${route.path}`}
              className={previewMode === route.mode ? 'is-selected' : ''}
              aria-current={previewMode === route.mode ? 'page' : undefined}
            >
              {route.label}
            </a>
          ))}
        </div>
      </nav>
      <button
        className={`controls-menu-button${isControlsPanelOpen ? ' is-open' : ''}`}
        hidden={previewMode !== '2d'}
        type="button"
        aria-controls="section-controls"
        aria-expanded={isControlsPanelOpen}
        aria-label={`${isControlsPanelOpen ? 'Hide' : 'Show'} section controls`}
        onClick={() => setControlsPanelPreferences((current) => ({
          ...current,
          [isLargeScreen ? 'desktop' : 'mobile']: !isControlsPanelOpen,
        }))}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <div className={`split-workspace${isControlsPanelOpen && previewMode === '2d' ? '' : ' is-controls-collapsed'}${previewMode === '2d' ? '' : ' is-planning-hidden'}`}>
        <section
          className="controls-panel"
          id="section-controls"
          aria-labelledby="controls-heading"
          hidden={!isControlsPanelOpen || previewMode !== '2d'}
        >
          <div className="panel-intro">
            <p className="eyebrow">Orchestra level</p>
            <h2 id="controls-heading">Section dimensions</h2>
            <p>Define the rows and columns for each seating section.</p>
          </div>

          <div className="column-labels" aria-hidden="true">
            <span>Section</span><span>Rows</span><span>Columns</span><span>Seats</span>
          </div>

          <div className="control-groups">
            {zones.map((zone) => (
              <fieldset className="control-group" key={zone}>
                <legend>
                  <span className="group-title"><strong>{zone}</strong> orchestra</span>
                  <button
                    type="button"
                    className={`group-lock-button${rowLocks[zone] ? ' is-locked' : ''}`}
                    aria-label={`Lock ${zone} rows`}
                    aria-pressed={rowLocks[zone]}
                    title={`Keep ${zone.toLowerCase()} rows consistent`}
                    onClick={() => toggleRowLock(zone)}
                  >
                    <LockIcon locked={rowLocks[zone]} />
                    <span>Rows</span>
                  </button>
                </legend>
                {sections
                  .filter((section) => section.zone === zone)
                  .map((section) => (
                    <div
                      className={`section-input-row${premiumSectionIds.has(section.id) ? ' is-premium' : ''}${reserveSectionIds.has(section.id) ? ' is-reserve' : ''}${hoveredSectionId === section.id ? ' is-highlighted' : ''}`}
                      key={section.id}
                    >
                      <div className="section-name">
                        <strong>{section.position}</strong>
                        <label
                          className="premium-toggle"
                          title={`${premiumSectionIds.has(section.id) ? 'Remove from' : 'Mark as'} premium admission`}
                        >
                          <input
                            type="checkbox"
                            checked={premiumSectionIds.has(section.id)}
                            aria-label={`${section.zone} ${section.position} premium admission`}
                            onChange={() => togglePremiumSection(section.id)}
                          />
                          <span aria-hidden="true">P</span>
                        </label>
                        <label
                          className="reserve-toggle"
                          title={`${reserveSectionIds.has(section.id) ? 'Remove from' : 'Mark as'} Premium Lite seating`}
                        >
                          <input
                            type="checkbox"
                            checked={reserveSectionIds.has(section.id)}
                            aria-label={`${section.zone} ${section.position} Premium Lite seating`}
                            onChange={() => toggleReserveSection(section.id)}
                          />
                          <span aria-hidden="true">R</span>
                        </label>
                        <button
                          type="button"
                          className={`section-lock-button${columnLocks[section.position] ? ' is-locked' : ''}`}
                          aria-label={`Lock ${section.position} columns`}
                          aria-pressed={columnLocks[section.position]}
                          title={`Keep ${section.position.toLowerCase()} columns consistent`}
                          onClick={() => toggleColumnLock(section.position)}
                        >
                          <LockIcon locked={columnLocks[section.position]} />
                        </button>
                      </div>
                      <DimensionInput
                        label={`${section.zone} ${section.position} rows`}
                        value={section.rows}
                        max={maxRowsPerSection}
                        onChange={(value) => value > section.rows
                          ? incrementRows(section.id)
                          : updateSection(section.id, 'rows', value)}
                        onIncrement={() => incrementRows(section.id)}
                        onMax={() => showMaxToast(`${section.zone} rows`, maxRowsPerSection)}
                      />
                      <DimensionInput
                        label={`${section.zone} ${section.position} columns`}
                        value={section.columns}
                        min={minColumns}
                        max={maxColumns}
                        onChange={(value) => value > section.columns
                          ? incrementColumns(section.id)
                          : updateSection(section.id, 'columns', value)}
                        onIncrement={() => incrementColumns(section.id)}
                        onMax={() => showMaxToast(`${section.position} columns`, maxColumns)}
                      />
                      <output
                        className={hasTechBoothClearance(section) || section.id === 'rear-left'
                          ? 'has-clearance'
                          : ''}
                        title={hasTechBoothClearance(section)
                          ? `One ${section.columns}-seat row removed for tech booth clearance`
                          : section.id === 'rear-left'
                            ? 'One chair removed from the right side of row Z for tech booth clearance'
                            : undefined}
                      >
                        {sectionCapacity(section).toLocaleString()}
                      </output>
                    </div>
                  ))}
              </fieldset>
            ))}
          </div>
        </section>

        <section
          className={`preview-panel${previewMode === '3d' ? ' is-3d' : previewMode === 'stage' ? ' is-stage' : ''}`}
          aria-labelledby={`view-nav-${previewMode}`}
        >
          <div className="preview-heading" hidden={previewMode !== '2d'}>
            <div className="preview-tools">
              <div className="preview-actions">
                {previewMode === '2d' && (
                  <>
                    <button
                      className={`label-switch${showSectionLabels ? ' is-on' : ''}`}
                      type="button"
                      role="switch"
                      aria-checked={showSectionLabels}
                      onClick={() => setShowSectionLabels((current) => !current)}
                    >
                      <span aria-hidden="true" />
                      Section labels
                    </button>
                    <button
                      className="export-button"
                      type="button"
                      disabled={isExporting}
                      onClick={exportPlan}
                    >
                      {isExporting ? 'Exporting…' : 'Export PNG'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            className={`auditorium${audienceTotal > 0 ? ' has-audience' : ''}`}
            ref={auditoriumRef}
            hidden={previewMode !== '2d'}
          >
            <svg
              className="room-plan-details"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 100 160"
              role="img"
              aria-label="Approximate room outline with upper-left cutout, doors, left-wall garage door and tech stations"
            >
              <path d="M0 0H13V17H10V20H0Z" fill="#eef1eb" />
              <g fill="none" stroke="#65726b" strokeWidth="0.3">
                <path d="M13 17V0H100V160H90 M84 160H78 M72 160H66 M60 160H6 M0 160V44 M0 24V20H3 M9 20H10V17H13" />
                <g aria-label="Upper-left double doors">
                  <path d="M3 20V17A3 3 0 0 1 6 20 M9 20V17A3 3 0 0 0 6 20" />
                </g>
                <g aria-label="Four outward-swinging rear double-door sets">
                  {[0, 60, 72, 84].map((x) => (
                    <path key={x} d={`M${x} 160V163A3 3 0 0 0 ${x + 3} 160 M${x + 6} 160V163A3 3 0 0 1 ${x + 3} 160`} />
                  ))}
                </g>
                <g aria-label="Large garage door on left wall">
                  <path d="M0 24V44" />
                  <path d="M0 24H0.8 M0 44H0.8" />
                </g>
                <g aria-label="Two tech desk stations">
                  <rect x="29.5" y="152.5" width="8" height="2" fill="#c7cdca" />
                  <rect x="38.5" y="152.5" width="8" height="2" fill="#c7cdca" />
                  {[32.5, 41.5].map((x) => (
                    <g key={x}>
                      <rect x={x} y="155" width="2" height="2" rx="0.4" fill="#e3e8e2" />
                      <path d={`M${x} 157.2H${x + 2}`} />
                    </g>
                  ))}
                </g>
              </g>
            </svg>
            <div className="stage" aria-label="Stage, 48-foot-wide body with a 54-foot-wide front apron, 40 feet deep">
              <span>Stage</span>
            </div>
            <div className="seating-plan">
              {zones.map((zone, zoneIndex) => {
                const rowOffset = zones
                  .slice(0, zoneIndex)
                  .reduce((total, priorZone) => total + Math.max(
                    ...sections
                      .filter((section) => section.zone === priorZone)
                      .map((section) => section.rows),
                  ), 0)

                return (
                <section className="preview-zone" key={zone} aria-label={`${zone} orchestra`}>
                  <div className="preview-sections">
                    {sections
                      .filter((section) => section.zone === zone)
                      .map((section) => (
                          <div
                            className={`seat-block${section.zone === 'Rear' ? ' is-rear' : ''}${premiumSectionIds.has(section.id) ? ' is-premium' : ''}${reserveSectionIds.has(section.id) ? ' is-reserve' : ''}`}
                            key={section.id}
                            onMouseEnter={() => setHoveredSectionId(section.id)}
                            onMouseLeave={() => setHoveredSectionId(null)}
                          >
                            {showSectionLabels && (
                              <span className="section-label">
                                <strong>
                                  {admissionLabel(section, premiumSectionIds, reserveSectionIds)}
                                </strong>
                              </span>
                            )}
                            <div
                              className="seat-grid"
                              style={{ '--columns': section.columns } as CSSProperties}
                              aria-hidden="true"
                            >
                              {Array.from({ length: section.rows }, (_, row) => (
                                <div className="seat-row" key={row}>
                                  {section.position === 'Center' ? (
                                    <>
                                      <span className="row-label row-label-left">
                                        {rowLabel(rowOffset + row)}
                                      </span>
                                      <span className="row-label row-label-right">
                                        {rowLabel(rowOffset + row)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="row-label">
                                      {rowLabel(rowOffset + row)}
                                    </span>
                                  )}
                                  {seatPlacementsForRow(section, row).map((seat) => {
                                    const seatId = `${section.id}-${row}-${seat.id}`
                                    const seatLabel = seat.kind === 'wheelchair'
                                      ? wheelchairSymbol
                                      : null
                                    return (
                                      <span
                                        className={`${seat.kind === 'wheelchair' ? 'wheelchair-space' : 'seat'}${seat.kind === 'companion' ? ' companion-seat' : ''}${occupiedSeatIds.has(seatId) ? ' is-occupied' : ''}`}
                                        style={{ gridColumn: `span ${seat.span}` }}
                                        key={seat.id}
                                      >
                                        {seatLabel}
                                      </span>
                                    )
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                      ))}
                  </div>
                </section>
                )
              })}
            </div>
            <div className="tech-booth" aria-label="Two tech stations, 18 feet wide by 8 feet deep, within the combined 24-by-8-foot tech and camera area">
              <span>Tech booth</span>
              <small>Tech + camera: 24′ × 8′</small>
            </div>
            <div className="camera-position" aria-label="Camera position, 6 feet wide by 8 feet deep, within the combined tech and camera area">
              <span>Camera</span>
            </div>
          </div>
          {previewMode === 'stage' && (
            <Suspense fallback={<div className="venue-3d-loading">Building production stage plan...</div>}>
              <StagePlan />
            </Suspense>
          )}
          {previewMode === '3d' && (
            <Suspense fallback={<div className="venue-3d-loading">Building 3D venue…</div>}>
              <Venue3D
                seats={venueSeats}
                audienceTotal={audienceTotal}
                totalCapacity={totalSeats}
              />
            </Suspense>
          )}
        </section>

        {previewMode === '2d' && (
        <aside className="planning-panel" aria-label="Capacity and attendance planning">
          <div className="planning-heading">
            <p className="eyebrow">Event planning</p>
            <h2>Attendance preview</h2>
          </div>

          <section className="audience-density" aria-labelledby="audience-density-heading">
            <div className="audience-density-heading">
              <div>
                <h3 id="audience-density-heading">Seat visualization</h3>
                <p>Seating favors center sections and the middle of each row.</p>
              </div>
              <strong>{audienceTotal.toLocaleString()}</strong>
            </div>
            <div className="audience-view-toggle" role="group" aria-label="Seat visualization">
              <button
                type="button"
                className={audienceViewMode === 'sales' ? 'is-selected' : ''}
                aria-pressed={audienceViewMode === 'sales'}
                onClick={() => setAudienceViewMode('sales')}
              >
                Sales projection
              </button>
              <button
                type="button"
                className={audienceViewMode === 'full' ? 'is-selected' : ''}
                aria-pressed={audienceViewMode === 'full'}
                onClick={() => setAudienceViewMode('full')}
              >
                Full capacity
              </button>
            </div>
            <div className="audience-input-labels" aria-hidden="true">
              <span>Section</span>
              <span>Sold</span>
              <span>Show rate</span>
              <span>Expected</span>
            </div>
            <div className="audience-inputs">
              {admissionCategories.map((category) => (
                <div className={`audience-input audience-input-${category}`} key={category}>
                  <span className="audience-category-label">
                    {admissionCategoryLabels[category]}
                    {category === 'reserved' && (
                      <small>
                        {ticketSales.reserved.toLocaleString()} sold
                        {' + '}{premiumLiteVolunteerCount} volunteers
                        {' = '}{(ticketSales.reserved + premiumLiteVolunteerCount).toLocaleString()}
                      </small>
                    )}
                  </span>
                  <label>
                    <span className="sr-only">{admissionCategoryLabels[category]} tickets sold</span>
                    <input
                      type="number"
                      min="0"
                      value={ticketSales[category] ?? 0}
                      onChange={(event) =>
                        updateTicketSales(category, Number(event.target.value))}
                    />
                  </label>
                  <label className="attendance-rate-input">
                    <span className="sr-only">
                      {admissionCategoryLabels[category]} attendance rate
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={attendanceRates[category]}
                      onChange={(event) =>
                        updateAttendanceRate(category, Number(event.target.value))}
                    />
                    <span aria-hidden="true">%</span>
                  </label>
                  <output
                    aria-label={`${admissionCategoryLabels[category]} expected attendance`}
                    title={category === 'reserved'
                      ? `${ticketSales.reserved.toLocaleString()} sold × ${attendanceRates.reserved}% + ${premiumLiteVolunteerCount} volunteers; capacity ${categoryCapacities.reserved.toLocaleString()}`
                      : `Capacity: ${categoryCapacities[category].toLocaleString()} seats`}
                  >
                    {projectedAudienceCounts[category].toLocaleString()}
                  </output>
                </div>
              ))}
            </div>
            <div className="audience-density-footer">
              <span>
                {totalSeats > 0 ? Math.round(audienceTotal / totalSeats * 100) : 0}% full
              </span>
              <button
                type="button"
                disabled={audienceViewMode === 'full' || audienceTotal === 0}
                onClick={() => setAudienceSeed((current) => current + 1)}
              >
                Reshuffle seats
              </button>
            </div>
          </section>

          <section className="capacity-counts" aria-label="Seating capacity" aria-live="polite">
            <div className="total-count">
              <span>Total capacity</span>
              <strong>{totalSeats.toLocaleString()}</strong>
              <small>seats</small>
            </div>
            <div className="accessible-count">
              <span>Accessible seating</span>
              <strong>{wheelchairSpaces.toLocaleString()}</strong>
              <small>ADA + {wheelchairSpaces.toLocaleString()} companions</small>
            </div>
            <div className="premium-count">
              <span>Premium admission</span>
              <strong>{premiumSeats.toLocaleString()}</strong>
              <small>seats</small>
            </div>
            <div className="reserve-count">
              <span>Premium Lite</span>
              <strong>{reserveSeats.toLocaleString()}</strong>
              <small>seats</small>
            </div>
            <div className="general-count">
              <span>General admission</span>
              <strong>{generalSeats.toLocaleString()}</strong>
              <small>seats</small>
            </div>
          </section>

        </aside>
        )}
      </div>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span aria-hidden="true">!</span>
          {toast}
        </div>
      )}
    </main>
  )
}

export default App
