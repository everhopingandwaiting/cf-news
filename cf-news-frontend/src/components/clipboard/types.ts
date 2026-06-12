import type { ClipboardTransport } from '../../utils/clipboard';

export interface IncomingFileOffer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
    transport: ClipboardTransport;
    sender?: string;
    deviceId?: string;
}

export interface FileTransfer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
    receivedChunks: number;
    direction: 'send' | 'receive';
    status: 'offering' | 'accepted' | 'transferring' | 'complete' | 'cancelled' | 'rejected';
    progress: number;
    startedAt: number;
    completedAt?: number;
    transport: ClipboardTransport;
    error?: string;
}

export interface ClipboardDevice {
    deviceId: string;
    deviceName: string;
    connectedAt: number;
}

export interface ClipboardShareProps {
    visible: boolean;
    onClose: () => void;
    userId: string;
    text: string;
    images: { data: string; mime: string; sender?: string }[];
    connected: boolean;
    connecting: boolean;
    pendingCount: number;
    deviceName: string;
    onSendText: (content: string) => void;
    onSendImage: (data: string, mime: string) => void;
    onSyncClipboard: (content: string) => void;
    onClearImages: () => void;
    incomingOffers: IncomingFileOffer[];
    fileTransfers: FileTransfer[];
    devices: ClipboardDevice[];
    currentDeviceId: string;
    onSendFile: (file: File, transport: ClipboardTransport) => void;
    onAcceptFile: (transferId: string) => void;
    onRejectFile: (transferId: string) => void;
    onCancelFile: (transferId: string) => void;
}
