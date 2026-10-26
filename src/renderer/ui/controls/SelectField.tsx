export type SelectFieldProps<T extends string> = {
  label: string
  value: T | null
  mixed?: boolean
  options: readonly T[]
  onCommit: (value: T) => void
}

export function SelectField<T extends string>({
  label,
  value,
  mixed,
  options,
  onCommit,
}: SelectFieldProps<T>): React.ReactElement {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className="field-input"
        value={mixed ? '' : (value ?? '')}
        onChange={(event) => onCommit(event.target.value as T)}
      >
        {mixed ? <option value="">Mixed</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
