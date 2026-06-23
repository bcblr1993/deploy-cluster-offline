// 渲染侧 IPC 封装：直接复用 preload 暴露的、强类型的 window.deployApi。

export const ipc = window.deployApi
