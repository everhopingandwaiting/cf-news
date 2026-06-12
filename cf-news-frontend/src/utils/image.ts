const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export function compressImage(blob: Blob): Promise<Blob> {
    return new Promise((resolve) => {
        if (blob.size <= MAX_IMAGE_SIZE) { resolve(blob); return; }
        const img = new Image();
        img.onload = async () => {
            const outputType = blob.type === 'image/gif' ? 'image/jpeg' : blob.type;
            let scale = Math.min(1, Math.sqrt(MAX_IMAGE_SIZE / blob.size));
            let quality = 0.85;
            let result: Blob | null = blob;
            for (let attempt = 0; attempt < 5; attempt++) {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(result); return; }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const out = await new Promise<Blob | null>(r => canvas.toBlob(r, outputType, quality));
                if (out) result = out;
                if (result && result.size <= MAX_IMAGE_SIZE) break;
                scale *= 0.75;
                quality = Math.max(0.3, quality - 0.15);
            }
            URL.revokeObjectURL(img.src);
            resolve(result || blob);
        };
        img.onerror = () => { URL.revokeObjectURL(img.src); resolve(blob); };
        img.src = URL.createObjectURL(blob);
    });
}
