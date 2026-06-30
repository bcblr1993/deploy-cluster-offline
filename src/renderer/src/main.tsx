import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { useWizard } from './store/wizard'
import './styles/design.css'

function Root() {
  const theme = useWizard((s) => s.theme)
  useEffect(() => {
    document.documentElement.setAttribute('data-app-theme', theme)
    document.documentElement.style.background = theme === 'dark' ? '#0b0c0e' : '#f5f6f8'
  }, [theme])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#1f7bf0',
          fontFamily: "'Manrope', system-ui, sans-serif",
          borderRadius: 9
        }
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
