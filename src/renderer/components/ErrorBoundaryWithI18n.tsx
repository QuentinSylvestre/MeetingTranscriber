import React from 'react';
import { useI18n } from '../hooks/useI18n';
import ErrorBoundary from './ErrorBoundary';

// Thin wrapper that reads i18n context and passes translated strings as props.
// ErrorBoundary is a class component and cannot use hooks directly.
export default function ErrorBoundaryWithI18n({ children }: { children: React.ReactNode }): React.ReactElement {
  const { t } = useI18n();
  return (
    <ErrorBoundary
      heading={t('error_heading')}
      body={t('error_body')}
      reloadLabel={t('error_btn_reload')}
    >
      {children}
    </ErrorBoundary>
  );
}
