# Video del salvapantallas del kiosko

Coloca aquí `salvapantallas-kiosko.mp4`. Si no existe, el kiosko muestra sólo el reloj.

Requisitos para que se reproduzca en Chrome y en la Raspberry Pi:
- H.264 (no HEVC/H.265), 8 bits, `yuv420p`, sin audio.
- Vertical si el kiosko está en vertical.

Para convertir (por ejemplo un clip de Higgsfield, que sale en HEVC 10 bits):

    ffmpeg -i entrada.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -an -movflags +faststart salvapantallas-kiosko.mp4
