export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.icon ? option.label : undefined}
          title={option.label}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  )
}
