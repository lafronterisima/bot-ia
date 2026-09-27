FROM node:20-slim

WORKDIR /workspace

# 1. Copiar archivos de dependencias
COPY package*.json ./

# 2. INSTALAR DEPENDENCIAS (Línea indispensable)
RUN npm install

# 3. Copiar el resto del código fuente
COPY . .

EXPOSE 8080

# 4. Iniciar tu archivo principal real (index.js)
CMD ["node", "index.js"]
