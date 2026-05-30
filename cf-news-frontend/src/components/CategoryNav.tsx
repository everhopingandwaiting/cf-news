interface Props {
  categories: { key: string; label: string; emoji: string }[];
  active: string;
  onSelect: (key: string) => void;
}

export default function CategoryNav({ categories, active, onSelect }: Props) {
  return (
    <nav className="flex gap-1.5 flex-wrap mb-5">
      {categories.map((cat) => (
        <button
          key={cat.key}
          className={`px-4 py-2 rounded-full text-[13px] font-medium border transition-all duration-150 ${
            active === cat.key
              ? 'bg-indigo-500 text-white border-transparent'
              : 'bg-white text-gray-400 border-gray-200 hover:border-indigo-500 hover:text-indigo-500'
          }`}
          onClick={() => onSelect(cat.key)}
        >
          {cat.emoji} {cat.label}
        </button>
      ))}
    </nav>
  );
}
