import React, { useState, useEffect } from 'react';
import Drawer from './Drawer';
import { auditLogService, AUDIT_LOG_UPDATED_EVENT } from '../services/auditLogService';
import type { AIAuditLog } from '../types';
import { useTranslation } from '../services/i18n';

interface AIAuditLogDrawerProps {
    show: boolean;
    onClose: () => void;
}

const AIAuditLogDrawer: React.FC<AIAuditLogDrawerProps> = ({ show, onClose }) => {
    const [logs, setLogs] = useState<AIAuditLog[]>([]);
    const { t } = useTranslation();

    useEffect(() => {
        const handleLogUpdate = () => {
            setLogs(auditLogService.getLogs());
        };

        window.addEventListener(AUDIT_LOG_UPDATED_EVENT, handleLogUpdate);

        if (show) {
            handleLogUpdate();
        }

        return () => {
            window.removeEventListener(AUDIT_LOG_UPDATED_EVENT, handleLogUpdate);
        };
    }, [show]);

    const handleClearLogs = () => {
        if (window.confirm(t('clearLogsConfirmation'))) {
            auditLogService.clearLogs();
        }
    };

    return (
        <Drawer title={t('auditLogTitle')} show={show} onClose={onClose}>
            {() => (
                <div className="space-y-4">
                    <div className="flex justify-between items-center gap-4">
                        <p className="text-sm text-sage">{t('auditLogDescription')}</p>
                        <button
                            onClick={handleClearLogs}
                            className="bg-clay hover:bg-clay-deep text-paper font-bold py-2 px-3 rounded-lg text-sm transition flex-shrink-0 disabled:bg-felt-700 disabled:cursor-not-allowed"
                            disabled={logs.length === 0}
                        >
                            {t('clearLogs')}
                        </button>
                    </div>
                    {logs.length === 0 ? (
                        <p className="text-center text-sage/70 py-8">{t('noLogs')}</p>
                    ) : (
                        <div className="space-y-2">
                            {logs.map((log) => (
                                <details key={log.id} className="bg-felt-900 rounded-lg">
                                    <summary className="p-3 cursor-pointer block font-medium text-paper">
                                        <div className="flex justify-between items-start">
                                            <div className="flex flex-col md:flex-row md:items-center md:gap-3">
                                                <span className="font-semibold">{log.mode}</span>
                                                <span className="text-xs text-sage">
                                                    {new Date(log.timestamp).toLocaleString()}
                                                </span>
                                            </div>
                                            {log.error ? (
                                                <span className="text-xs font-bold text-red-300 bg-red-900/40 px-2 py-1 rounded-full flex-shrink-0 ml-2">
                                                    {t('error')}
                                                </span>
                                            ) : (
                                                <span className="text-xs font-bold text-green-300 bg-green-900/40 px-2 py-1 rounded-full flex-shrink-0 ml-2">
                                                    {t('success')}
                                                </span>
                                            )}
                                        </div>
                                        {!log.error &&
                                            (log.model ||
                                                log.inputTokens !== undefined ||
                                                log.outputTokens !== undefined) && (
                                                <div className="mt-2 pt-2 border-t border-felt-700 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-sage font-normal">
                                                    {log.model && (
                                                        <div title="Model">
                                                            <span
                                                                className="font-mono text-paper/80 truncate"
                                                                title={log.model}
                                                            >
                                                                {log.model}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-x-3">
                                                        {log.inputTokens !== undefined && (
                                                            <div title="Input Tokens">
                                                                <span className="font-mono">
                                                                    <span className="text-sage/70">
                                                                        In:
                                                                    </span>{' '}
                                                                    <span className="text-brass">
                                                                        {log.inputTokens.toLocaleString()}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        )}
                                                        {log.outputTokens !== undefined && (
                                                            <div title="Output Tokens">
                                                                <span className="font-mono">
                                                                    <span className="text-sage/70">
                                                                        Out:
                                                                    </span>{' '}
                                                                    <span className="text-green-300">
                                                                        {log.outputTokens.toLocaleString()}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                    </summary>
                                    <div className="p-4 border-t border-felt-700 space-y-4 text-sm">
                                        {log.requestDetails && (
                                            <div>
                                                <h4 className="font-semibold text-paper mb-1">
                                                    {t('requestDetails')}
                                                </h4>
                                                <pre className="p-2 bg-felt-900/80 rounded-md text-sage whitespace-pre-wrap font-mono text-xs">
                                                    {JSON.stringify(log.requestDetails, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                        {log.systemInstruction && (
                                            <div>
                                                <h4 className="font-semibold text-paper mb-1">
                                                    {t('systemInstruction')}
                                                </h4>
                                                <pre className="p-2 bg-felt-900/80 rounded-md text-sage whitespace-pre-wrap font-mono text-xs">
                                                    {log.systemInstruction}
                                                </pre>
                                            </div>
                                        )}
                                        <div>
                                            <h4 className="font-semibold text-paper mb-1">
                                                {t('prompt')}
                                            </h4>
                                            <pre className="p-2 bg-felt-900/80 rounded-md text-sage whitespace-pre-wrap font-mono text-xs">
                                                {log.prompt}
                                            </pre>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-paper mb-1">
                                                {t('response')}
                                            </h4>
                                            <pre className="p-2 bg-felt-900/80 rounded-md text-green-300 whitespace-pre-wrap font-mono text-xs">
                                                {log.response || t('emptyResponse')}
                                            </pre>
                                        </div>
                                        {log.error && (
                                            <div>
                                                <h4 className="font-semibold text-red-300 mb-1">
                                                    {t('error')}
                                                </h4>
                                                <pre className="p-2 bg-felt-900/80 rounded-md text-red-300 whitespace-pre-wrap font-mono text-xs">
                                                    {log.error}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Drawer>
    );
};

export default AIAuditLogDrawer;
