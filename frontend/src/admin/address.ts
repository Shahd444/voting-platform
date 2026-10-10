/** True for an address only this computer can open ("localhost", 127.x, ::1); phones cannot reach it. */
export const isLocalAddress = (value: string) => /^(https?:\/\/)?(localhost|127\.|\[?::1)/i.test(value.trim());
