import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { SettingsProvider } from './state/SettingsProvider.jsx';
import { I18nProvider } from './i18n/index.js';
import { ChartThemeProvider } from './components/charts/ChartThemeProvider.jsx';
import ChartPatterns from './components/charts/ChartPatterns.jsx';
import './index.css';

/*
 * Provider order matters.
 *
 * SettingsProvider is outermost because it is what writes the theme onto <html>;
 * ChartThemeProvider reads those attributes back, so it has to mount inside. I18n
 * sits between them: the locale is a settings value, and chart axis labels are
 * translated.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SettingsProvider>
      <I18nProvider>
        <ChartThemeProvider>
          <ChartPatterns />
          <App />
        </ChartThemeProvider>
      </I18nProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
