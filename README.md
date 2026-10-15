# Vice Run

Cuenta atrás hasta el 19 de noviembre + arcade con ranking online verificado.

## Cambiar los datos de la moneda
Edita `public/config.js` (ticker, premio, contrato, enlace de X y de pump.fun).

## Cómo funciona el ranking
- El servidor da una semilla a cada partida (`/api/start`).
- Al guardar, el navegador manda todos los movimientos. El servidor repite la partida con el mismo código (`public/game-core.js`) y solo la acepta si la puntuación cuadra y no ha ido más rápida que el tiempo real.
- Se guarda la mejor puntuación de cada usuario de X, con sus movimientos, para poder revisar al ganador.

## Desplegar en Render
1. New → Web Service → este repo. Build: `npm install`. Start: `npm start`.
2. Variable de entorno `DATABASE_URL`: la cadena de conexión de Postgres (Supabase → Connect → *Session pooler*).
   Sin ella, las puntuaciones se guardan en un archivo y se pierden cuando Render reinicia.

## Probar en local
`npm install && npm start` → http://localhost:3000
