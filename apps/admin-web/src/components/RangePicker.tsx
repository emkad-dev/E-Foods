import { RANGE_OPTIONS, type RangeDays } from '../lib/analytics';

export default function RangePicker({ value, onChange }: { value: RangeDays; onChange: (next: RangeDays) => void }) {
  return (
    <select
      className="select-pill"
      value={value}
      onChange={(event) => onChange(Number(event.target.value) as RangeDays)}
      aria-label="Date range"
    >
      {RANGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
