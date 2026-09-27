FROM node:20-slim

WORKDIR /workspace

# Copiar manifiestos
COPY package*.json ./



# Copiar el resto del código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
