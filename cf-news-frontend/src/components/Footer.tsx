import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = 'Asia/Shanghai';

export default function Footer() {
  const buildTime = import.meta.env.VITE_BUILD_TIME || '';
  const buildPlatform = import.meta.env.VITE_BUILD_PLATFORM || '';
  const buildVersion = import.meta.env.VITE_BUILD_VERSION || '';
  const buildCommit = import.meta.env.VITE_BUILD_COMMIT || '';

  const fmt = (iso: string) => {
    if (!iso) return '';
    const d = dayjs(iso);
    if (!d.isValid()) return iso;
    return d.tz(TZ).format('YYYY-MM-DD HH:mm:ss');
  };

  const parts: string[] = [];
  if (buildVersion) parts.push(`v${buildVersion}`);
  if (buildPlatform) parts.push(buildPlatform);
  if (buildTime) parts.push(fmt(buildTime));
  if (buildCommit) parts.push(buildCommit.slice(0, 7));

  if (parts.length === 0) return null;

  return (
    <footer className="mt-12 mb-6 text-center">
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100/60 dark:bg-gray-800/30 text-[11px] text-gray-400 dark:text-gray-500 tracking-wide font-mono">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="w-[3px] h-[3px] rounded-full bg-gray-300 dark:bg-gray-600" />}
            {p}
          </span>
        ))}
      </div>
    </footer>
  );
}
