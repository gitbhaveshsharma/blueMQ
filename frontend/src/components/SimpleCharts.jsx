function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString();
}

function EmptyChartState({ message }) {
  return (
    <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400">
      {message}
    </div>
  );
}

export function LineTrendChart({
  data,
  title,
  valueKey = "total",
  labelKey = "label",
  colorClass = "stroke-indigo-500",
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <EmptyChartState message="No timeline data" />;
  }

  const points = data.map((item) => Number(item[valueKey]) || 0);
  const max = Math.max(...points, 1);
  const width = 720;
  const height = 200;
  const padding = 24;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const path = points
    .map((value, index) => {
      const x =
        data.length === 1
          ? width / 2
          : padding + (index / (data.length - 1)) * usableWidth;
      const y = padding + (1 - value / max) * usableHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {title ? (
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 h-48 w-full overflow-visible"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const y = padding + step * usableHeight;
          return (
            <line
              key={step}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
          );
        })}
        <path
          d={path}
          className={colorClass}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((value, index) => {
          const x =
            data.length === 1
              ? width / 2
              : padding + (index / (data.length - 1)) * usableWidth;
          const y = padding + (1 - value / max) * usableHeight;
          return (
            <circle
              key={`${index}-${value}`}
              cx={x}
              cy={y}
              r="4"
              fill="#6366F1"
            />
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500 sm:grid-cols-4">
        {data.slice(-4).map((item) => (
          <div key={item[labelKey]} className="rounded-md bg-gray-50 px-2 py-1">
            <div className="truncate">{item[labelKey]}</div>
            <div className="font-medium text-gray-700">
              {formatNumber(item[valueKey])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelBarChart({
  data,
  title,
  valueKey = "total",
  labelKey = "channel",
  barClass = "bg-indigo-500",
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <EmptyChartState message="No distribution data" />;
  }

  const max = Math.max(...data.map((item) => Number(item[valueKey]) || 0), 1);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {title ? (
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      ) : null}
      <div className="mt-4 space-y-3">
        {data.map((item) => {
          const value = Number(item[valueKey]) || 0;
          const percent = Math.max(4, Math.round((value / max) * 100));
          return (
            <div key={`${item[labelKey]}-${value}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="capitalize">{item[labelKey]}</span>
                <span className="font-medium text-gray-700">
                  {formatNumber(value)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${barClass}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MetricCard({ label, value, hint, tone = "indigo" }) {
  const toneClasses = {
    indigo: "text-indigo-600 bg-indigo-50",
    emerald: "text-emerald-600 bg-emerald-50",
    red: "text-red-600 bg-red-50",
    amber: "text-amber-600 bg-amber-50",
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-2 inline-flex rounded-md px-2 py-1 text-2xl font-semibold ${toneClasses[tone] || toneClasses.indigo}`}
      >
        {formatNumber(value)}
      </p>
      {hint ? <p className="mt-2 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}
