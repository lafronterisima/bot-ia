FROM node:20-alpine

WORKDIR /workspace

# Copiar archivos de manifiesto
COPY package*.json ./

# Instalar dependencias omitiendo opcionales y audit
RUN npm install --omit=optional --no-audit --no-fund

# Copiar el código fuente
COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
