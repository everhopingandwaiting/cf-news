interface Props {
    src: string | null;
    onClose: () => void;
}

export default function ImagePreviewModal({ src, onClose }: Props) {
    if (!src) return null;
    return (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-8" onClick={onClose}>
            <img src={src} className="max-w-full max-h-full object-contain rounded-lg" alt="preview" />
        </div>
    );
}
