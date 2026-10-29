import { useMemo } from 'react'
import { createStagePlan } from './Venue3D'
import type { StageScene } from './StageScenes'

const channelLabel = (name: string) => /^Inputs? ([\d-]+):/.exec(name)?.[1] ?? ''
const shortLabel = (name: string) => name.replace(/^Inputs? [\d-]+: /, '')

const fixtureLabel = (name: string) => {
  if (channelLabel(name)) return channelLabel(name)
  if (/^Stage-(left|right) stairs/.test(name)) return ''
  if (name.startsWith('Conductor')) return ''
  if (name === 'Stage camera facing center winds') return 'DJI / phone'
  return name.replace('Yamaha 7000 concert bass drum', 'Bass drum')
    .replace('Concert harp', 'Harp')
    .replace('Banchan bowl percussion table', 'Bowls')
    .replace('Auxiliary percussion table', 'Aux table')
    .replace('Crash cymbals on stand', 'Crash')
    .replace('Suspended cymbal', 'Sus. cymbal')
    .replace('-inch timpano', '" timp.')
}

export default function StagePlan({ scene }: {
  scene: StageScene
}) {
  const plan = useMemo(() => {
    try {
      return { items: createStagePlan(scene), error: null }
    } catch (error) {
      console.error('Could not build the production stage plan.', error)
      return { items: [], error: 'Could not build the production stage plan. Please reload to try again.' }
    }
  }, [scene])
  if (plan.error) return <div role="alert">{plan.error}</div>
  const { items } = plan
  const inputs = items.filter((item) => channelLabel(item.name))
    .sort((a, b) => Number(channelLabel(a.name).split('-')[0]) - Number(channelLabel(b.name).split('-')[0]))
  const channelCount = inputs.reduce((total, item) => {
    const channels = channelLabel(item.name).split('-').map(Number)
    return total + (channels.length === 2 ? channels[1] - channels[0] + 1 : 1)
  }, 0)
  return (
    <div className="stage-production-page">
      <div className="stage-production">
      <div className="stage-production-map">
        <svg viewBox="-35 -83 73 48" role="img" aria-label="Production stage plan with musician chairs, instruments, stage stairs and numbered microphone inputs">
          <path d="M-24 -80H24V-48H27V-40H-27V-48H-24Z" fill="#eef1eb" stroke="#526559" strokeWidth=".15" />
          {[-80, -64, -56, -48].map((z) => (
            <path key={z} d={`M-24 ${z}H24`} stroke="#a6b4a9" strokeWidth=".1" />
          ))}
          {items.filter((item) => item.kind === 'fixture').map((item, index) => (
            <g key={index}>
              <title>{item.name}{item.percussionActive === null ? '' : ` — ${item.percussionActive ? 'active' : 'parked / inactive'} in ${scene}`}</title>
              <rect x={item.centerX - item.width / 2} y={item.centerZ - item.depth / 2}
                width={item.width} height={item.depth} rx=".12"
                fill={item.percussionActive === false ? '#edf0ed' : '#d4ddd5'}
                stroke={item.percussionActive === false ? '#a2aaa4' : '#607365'}
                strokeDasharray={item.percussionActive === false ? '.3 .2' : undefined}
                strokeWidth=".1" />
              {Array.from({ length: item.stairCount }, (_, step) => (
                <line key={step}
                  x1={item.centerX - item.width / 2 + step * item.width / item.stairCount}
                  x2={item.centerX - item.width / 2 + step * item.width / item.stairCount}
                  y1={item.centerZ - item.depth / 2} y2={item.centerZ + item.depth / 2}
                  stroke="#607365" strokeWidth=".1" />
              ))}
              {item.stairCount > 0 && (
                <path d="M2 .5H-2l.6 -.3m-.6 .3l.6 .3"
                  transform={`translate(${item.centerX} ${item.centerZ}) scale(${item.centerX > 0 ? 1 : -1} 1)`}
                  fill="none" stroke="#233b2b" strokeWidth=".15" />
              )}
              <text x={item.centerX} y={item.centerZ} textAnchor="middle" fontSize=".48"
                fill={item.percussionActive === false ? '#818b84' : '#233b2b'}>
                {fixtureLabel(item.name)}
              </text>
            </g>
          ))}
          {items.filter((item) => item.kind === 'chair').map((item, index) => (
            <g key={index} transform={`translate(${item.x} ${item.z}) rotate(${-item.yaw * 180 / Math.PI})`}>
              <title>{item.name}</title>
              <rect x="-.725" y="-.7" width="1.45" height="1.4" rx=".15" fill={item.color} stroke="#35463b" strokeWidth=".07" />
              <path d="M-.72 .62H.72" stroke="#233b2b" strokeWidth=".2" />
              <path d="M0 -.3V-.95M-.2 -.75L0 -.95L.2 -.75" fill="none" stroke="#fff" strokeWidth=".09" />
            </g>
          ))}
          {items.filter((item) => item.kind === 'microphone').map((item, index) => (
            <g key={index} className="stage-plan-mic">
              <title>{item.name}</title>
              {item.capsules.map((capsule, capsuleIndex) => (
                <g key={capsuleIndex}>
                  <line x1={item.x} y1={item.z} x2={capsule.x} y2={capsule.z} stroke="#bf442c" strokeWidth=".12" />
                  <circle cx={capsule.x} cy={capsule.z} r=".16" fill="#bf442c" />
                </g>
              ))}
              <path d={`M${item.x - .4} ${item.z + .3}L${item.x} ${item.z - .4}L${item.x + .4} ${item.z + .3}Z`}
                fill="none" stroke="#bf442c" strokeWidth=".1" />
              <circle cx={item.x} cy={item.z} r=".68" fill="#fff6eb" stroke="#bf442c" strokeWidth=".1" />
              <text x={item.x} y={item.z + .23} textAnchor="middle" fontSize=".68" fontWeight="800" fill="#842d1d">{channelLabel(item.name)}</text>
            </g>
          ))}
          <text x="0" y="-37" textAnchor="middle" fontSize="1" fill="#526559">DOWNSTAGE / AUDIENCE</text>
        </svg>
      </div>
      <aside className="stage-input-list" aria-label="Production input patch list">
        <header className="stage-input-header">
          <h2>Input patch <span>{channelCount}</span></h2>
          <p>{channelCount - 4} microphones <span aria-hidden="true">/</span> 4 DI channels</p>
        </header>
        <ol tabIndex={0} aria-label="Input channels">
          {inputs.map((item) => (
            <li key={item.name}><strong>{channelLabel(item.name)}</strong><span>{shortLabel(item.name)}</span></li>
          ))}
        </ol>
        {scene !== 'barber' && <p className="stage-input-reserved">Input 3 reserved for violin soloist.</p>}
      </aside>
      </div>
    </div>
  )
}
