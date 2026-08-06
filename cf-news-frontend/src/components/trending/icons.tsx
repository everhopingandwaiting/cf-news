/* ═══════════════════════════════════════════════════════
   trending/icons.tsx — 共享 SVG 图标库 + 空状态组件
   与 NewsDetailModal.tsx 的 iconPaths 同风格（heroicons 24x24）
   ═══════════════════════════════════════════════════════ */

const iconPaths = {
  search: { d: ['M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'] },
  tag: { d: ['M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z', 'M6 6h.008v.008H6V6z'] },
  trending: { d: ['M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941'] },
  chart: { d: ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'] },
  newspaper: { d: ['M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125v18.75M19.5 21h-15A2.25 2.25 0 012.25 18.75V3.75c0-.621.504-1.125 1.125-1.125H12a1.125 1.125 0 011.125 1.125v16.5c0 .621.504 1.125 1.125 1.125z'] },
  grid: { d: ['M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'] },
  sparkle: { d: ['M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z'], fill: true },
  refresh: { d: ['M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'] },
  document: { d: ['M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z'] },
  chevron: { d: ['M19.5 8.25l-7.5 7.5-7.5-7.5'] },
  close: { d: ['M6 6l12 12M18 6L6 18'] },
  fire: { d: ['M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.176 7.547 7.547 0 01-1.705-1.715.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.546 3.75 3.75 0 013.255 3.718z'], fill: true },
  bolt: { d: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'], fill: true },
  eye: { d: ['M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'] },
  upRight: { d: ['M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25'] },
  downRight: { d: ['M4.5 4.5l15 15m0 0H8.25m11.25 0V8.25'] },
  clock: { d: ['M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z'] },
} satisfies Record<string, { d: string[]; fill?: boolean }>;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = 'w-3.5 h-3.5', filled }: { name: IconName; className?: string; filled?: boolean }) {
  const cfg = iconPaths[name];
  const isFilled = filled ?? ('fill' in cfg ? cfg.fill : false);
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={isFilled ? undefined : 1.8}
      strokeLinecap={isFilled ? undefined : 'round'}
      strokeLinejoin={isFilled ? undefined : 'round'}
      aria-hidden="true"
    >
      {cfg.d.map((path, i) => <path key={i} d={path} />)}
    </svg>
  );
}

/* ─── 空状态：所有 trending 标签页共用的「暂无数据」占位 ─── */
export function EmptyState({ icon = 'newspaper', title = '暂无数据', hint }: { icon?: IconName; title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 animate-fadeIn">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <Icon name={icon} className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-[13px] font-medium text-gray-500">{title}</p>
      {hint && <p className="text-[12px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
