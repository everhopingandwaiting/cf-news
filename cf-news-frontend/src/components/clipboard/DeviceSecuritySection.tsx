import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = 'Asia/Shanghai';

import type { ClipboardDevice } from './types';

interface Props {
    devices: ClipboardDevice[];
    currentDeviceId: string;
    trustedDevices: string[];
    onToggleTrusted: (deviceId: string) => void;
    privateMode: boolean;
    onPrivateModeChange: (v: boolean) => void;
    autoAccept: boolean;
    onAutoAcceptChange: (v: boolean) => void;
    showDevices: boolean;
    onToggleShowDevices: () => void;
}

export default function DeviceSecuritySection({
    devices, currentDeviceId, trustedDevices, onToggleTrusted,
    privateMode, onPrivateModeChange, autoAccept, onAutoAcceptChange,
    showDevices, onToggleShowDevices,
}: Props) {
    return (
        <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[13px] font-medium text-gray-700">设备与安全</h3>
                <button className="text-[11px] text-gray-400 hover:text-indigo-500" onClick={onToggleShowDevices}>
                    {devices.length} 在线
                </button>
            </div>
            <label className="flex items-center justify-between text-[12px] text-gray-600">
                <span>私密模式（不写入本机历史）</span>
                <input type="checkbox" checked={privateMode} onChange={e => onPrivateModeChange(e.target.checked)} />
            </label>
            <label className="mt-2 flex items-center justify-between text-[12px] text-gray-600">
                <span>自动接受文件请求</span>
                <input type="checkbox" checked={autoAccept} onChange={e => onAutoAcceptChange(e.target.checked)} />
            </label>
            {showDevices && (
                <div className="mt-2 border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                    {devices.map(d => (
                        <div key={d.deviceId} className="px-3 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-[12px] text-gray-700 truncate">{d.deviceName}{d.deviceId === currentDeviceId ? '（本机）' : ''}</div>
                                <div className="text-[10px] text-gray-400">{dayjs(d.connectedAt).tz(TZ).format('YYYY-MM-DD HH:mm:ss')}</div>
                            </div>
                            {d.deviceId !== currentDeviceId && (
                                <button className={`text-[11px] ${trustedDevices.includes(d.deviceId) ? 'text-emerald-600' : 'text-gray-400 hover:text-indigo-500'}`} onClick={() => onToggleTrusted(d.deviceId)}>
                                    {trustedDevices.includes(d.deviceId) ? '可信' : '设为可信'}
                                </button>
                            )}
                        </div>
                    ))}
                    {devices.length === 0 && <div className="px-3 py-2 text-[12px] text-gray-400">暂无在线设备</div>}
                </div>
            )}
        </div>
    );
}
