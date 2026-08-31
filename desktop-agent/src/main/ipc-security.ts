export interface IpcSourceIdentity {
  readonly webContentsId: number
  readonly processId: number
  readonly routingId: number
}

export function isTrustedIpcSource(actual: IpcSourceIdentity, expected: IpcSourceIdentity): boolean {
  return actual.webContentsId === expected.webContentsId &&
    actual.processId === expected.processId &&
    actual.routingId === expected.routingId
}
