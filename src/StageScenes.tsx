export type StageScene = 'hisaishi' | 'barber' | 'holst' | 'williams' | 'korngold' | 'ravel'

export default function SceneSelector({
  scene,
  onChange,
}: {
  scene: StageScene
  onChange: (scene: StageScene) => void
}) {
  return (
    <label className="scene-selector">
      Scene
      <select value={scene} onChange={(event) => {
        const value = event.target.value
        if (value === 'hisaishi' || value === 'barber' || value === 'holst'
          || value === 'williams' || value === 'korngold' || value === 'ravel') onChange(value)
      }}>
        <option value="barber">Barber</option>
        <option value="holst">Holst</option>
        <option value="williams">Williams</option>
        <option value="korngold">Korngold</option>
        <option value="intermission" disabled>Intermission</option>
        <option value="ravel">Ravel</option>
        <option value="hisaishi">Hisaishi</option>
      </select>
    </label>
  )
}
