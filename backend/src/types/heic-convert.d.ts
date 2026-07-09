// Déclaration minimale : heic-convert ne fournit pas de types.
declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number; // 0..1 (JPEG uniquement)
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export = convert;
}
