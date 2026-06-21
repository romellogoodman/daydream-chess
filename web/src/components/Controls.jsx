// Controls panel: temperature ("dream width") slider, cap control, new game.
// Changing temperature/cap sends set_controls; the slider is framed as
// widening or tightening the dream halo around the model's mind.

export const TEMPERATURE_FLOOR = 0.3;
export const TEMPERATURE_DEFAULT = 0.8;
export const TEMPERATURE_CEIL = 1.5;
export const CAP_DEFAULT = 24;
export const CAP_MIN = 1;
export const CAP_MAX = 64;

function dreamLabel(t) {
  if (t < 0.55) return "a tight, lucid halo";
  if (t < 0.85) return "an even dream-width";
  if (t < 1.15) return "a wide, wandering halo";
  return "a vast, dissolving delirium";
}

function Controls({
  temperature,
  cap,
  disabled,
  onTemperatureChange,
  onCapChange,
  onNewGame,
}) {
  return (
    <div className="controls">
      <div className="controls__group">
        <label className="controls__label" htmlFor="temperature">
          delirium width
          <span className="controls__value">{temperature.toFixed(2)}</span>
        </label>
        <input
          id="temperature"
          className="controls__slider"
          type="range"
          min={TEMPERATURE_FLOOR}
          max={TEMPERATURE_CEIL}
          step={0.05}
          value={temperature}
          disabled={disabled}
          onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
        />
        <p className="controls__hint">{dreamLabel(temperature)}</p>
      </div>

      <div className="controls__group">
        <label className="controls__label" htmlFor="cap">
          dream cap
          <span className="controls__value">{cap}</span>
        </label>
        <input
          id="cap"
          className="controls__slider"
          type="range"
          min={CAP_MIN}
          max={CAP_MAX}
          step={1}
          value={cap}
          disabled={disabled}
          onChange={(e) => onCapChange(parseInt(e.target.value, 10))}
        />
        <p className="controls__hint">
          up to {cap} attempts before it must wake — or sleep
        </p>
      </div>

      <button
        type="button"
        className="controls__new-game"
        onClick={onNewGame}
        disabled={disabled}
      >
        New game
      </button>
    </div>
  );
}

export default Controls;
