interface Props {
  categories: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}

export default function CategoryNav({ categories, active, onSelect }: Props) {
  return (
    <nav className="flex gap-1.5 flex-wrap mb-5">
      {categories.map((cat) => (
        <button
          key={cat.key}
          className={`px-4 py-2 rounded-full text-[13px] font-medium border transition-all duration-150 inline-flex items-center justify-center gap-1.5 ${
            active === cat.key
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-transparent shadow-sm'
              : 'bg-white text-gray-400 border-gray-200 hover:border-indigo-500 hover:text-indigo-500 hover:-translate-y-0.5'
          }`}
          onClick={() => onSelect(cat.key)}
        >
          {active === cat.key && <span className="w-1.5 h-1.5 bg-white/60 rounded-full shrink-0" aria-hidden="true" />}
          {cat.label}
        </button>
      ))}
    </nav>
  );
}
