import { useRef } from 'react';

interface Props {
    images: { data: string; mime: string; sender?: string }[];
    onClearImages: () => void;
    onFileSelect: (file: File) => void;
    onImageCopy: (imgData: string, imgMime: string) => void;
    onPreview: (src: string) => void;
}

export default function ImageSharingSection({ images, onClearImages, onFileSelect, onImageCopy, onPreview }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            onFileSelect(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    return (
        <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
            <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[13px] font-medium text-gray-700">🖼 图片共享</h3>
                <div className="flex items-center gap-2">
                    {images.length > 0 && (
                        <>
                            <span className="text-[10px] text-gray-400">{images.length}</span>
                            <button className="text-[10px] text-red-400 hover:text-red-500 transition" onClick={onClearImages}>清除</button>
                        </>
                    )}
                    <span className="text-[10px] text-gray-400">≤5MB 超限自动压缩</span>
                    <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={() => fileInputRef.current?.click()}>
                        📷 选择图片
                    </button>
                </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            {images.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                    {images.map((img, i) => (
                        <div key={i} className="relative group">
                            <img src={`data:${img.mime};base64,${img.data}`}
                                className="w-20 h-20 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition"
                                onClick={() => onPreview(`data:${img.mime};base64,${img.data}`)} alt="" />
                            <button className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded active:bg-black/80 transition" onClick={(e) => {
                                e.stopPropagation();
                                onImageCopy(img.data, img.mime);
                            }}>复制</button>
                            {img.sender && <span className="absolute top-0.5 left-0.5 bg-black/50 text-white text-[8px] px-1 py-0.5 rounded">{img.sender}</span>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-[12px] text-gray-400 py-2">
                    支持粘贴、选择图片或直接拍照，超 5MB 自动压缩
                </div>
            )}
        </div>
    );
}
