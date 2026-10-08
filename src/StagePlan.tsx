import { useState } from 'react'
import { createStagePlan } from './Venue3D'

const channelLabel = (name: string) => /^Inputs? ([\d-]+):/.exec(name)?.[1] ?? ''
const shortLabel = (name: string) => name.replace(/^Inputs? [\d-]+: /, '')
  .replace('Principal First violins - first-desk microphone', 'Principal 1st violin')
  .replace('Principal Second violins - first-desk microphone', 'Principal 2nd violin')
  .replace('Principal Violas - first-desk microphone', 'Principal viola')
  .replace('Principal Cellos - first-desk microphone', 'Principal cello')
  .replace('Principal Basses - first-desk microphone', 'Principal bass')

const fixtureLabel = (name: string) => {
  if (channelLabel(name)) return channelLabel(name)
  if (name.startsWith('Stage-left stairs')) return 'UP TO 5 FT'
  if (name.startsWith('Conductor')) return ''
  if (name === 'Stage camera facing center winds') return 'Camera'
  return name.replace('Yamaha 7000 concert bass drum', 'Bass drum')
    .replace('Concert harp', 'Harp')
    .replace('Banchan bowl percussion table', 'Bowls')
    .replace('Auxiliary percussion table', 'Aux table')
    .replace('Crash cymbals on stand', 'Crash')
    .replace('Suspended cymbal', 'Sus. cymbal')
    .replace('-inch timpano', '" timp.')
}

export default function StagePlan() {
  const [plan] = useState(() => {
    try {
      return { items: createStagePlan(), error: null }
    } catch (error) {
      console.error('Could not build the production stage plan.', error)
      return { items: [], error: 'Could not build the production stage plan. Please reload to try again.' }
    }
  })
  if (plan.error) return <div role="alert">{plan.error}</div>
  const { items } = plan
  const inputs = items.filter((item) => channelLabel(item.name))
    .sort((a, b) => Number(channelLabel(a.name).split('-')[0]) - Number(channelLabel(b.name).split('-')[0]))
  return (
    <div className="stage-production">
      <div className="stage-production-map">
        <p>Top view · audience below · stage right on the left · dimensions in feet</p>
        <svg viewBox="-30 -83 68 48" role="img" aria-label="Production stage plan with musician chairs, instruments, stage-left stairs and numbered microphone inputs">
          <path d="M-24 -80H24V-48H27V-40H-27V-48H-24Z" fill="#eef1eb" stroke="#526559" strokeWidth=".15" />
          {[
            { z: -80, depth: 16, height: '6 ft' },
            { z: -64, depth: 8, height: '5 ft' },
            { z: -56, depth: 8, height: '4 ft' },
            { z: -48, depth: 8, height: '2 ft 8 in' },
          ].map((tier) => (
            <g key={tier.z}>
              <path d={`M-24 ${tier.z}H24`} stroke="#a6b4a9" strokeWidth=".1" />
              <text x="-26.8" y={tier.z + tier.depth / 2} fontSize=".65" fill="#526559">{tier.height}</text>
            </g>
          ))}
          {items.filter((item) => item.kind === 'fixture').map((item, index) => (
            <g key={index}>
              <title>{item.name}</title>
              <rect x={item.centerX - item.width / 2} y={item.centerZ - item.depth / 2}
                width={item.width} height={item.depth} rx=".12" fill="#d4ddd5" stroke="#607365" strokeWidth=".1" />
              {Array.from({ length: item.stairCount }, (_, step) => (
                <line key={step}
                  x1={item.centerX - item.width / 2 + step * item.width / item.stairCount}
                  x2={item.centerX - item.width / 2 + step * item.width / item.stairCount}
                  y1={item.centerZ - item.depth / 2} y2={item.centerZ + item.depth / 2}
                  stroke="#607365" strokeWidth=".1" />
              ))}
              {item.stairCount > 0 && (
                <path d={`M${item.centerX + 3} ${item.centerZ + 1}H${item.centerX - 3}l1 -.5m-1 .5l1 .5`}
                  fill="none" stroke="#233b2b" strokeWidth=".15" />
              )}
              <text x={item.centerX} y={item.centerZ} textAnchor="middle" fontSize=".48" fill="#233b2b">
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
        <p>Colored seats: musicians · red numbers: mic stand bases · red dots/lines: capsules/booms. Music stands are hidden in this view.</p>
      </div>
      <aside className="stage-input-list" aria-label="Production input patch list">
        <h2>Input patch · 26 channels</h2>
        <p>22 microphones + 4 DI channels</p>
        <ol>
          {inputs.map((item) => (
            <li key={item.name}><strong>{channelLabel(item.name)}</strong><span>{shortLabel(item.name)}</span></li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
