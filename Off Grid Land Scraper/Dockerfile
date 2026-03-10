# Use Apify's base image for Node.js actors
FROM apify/actor-node:20

# Copy package files
COPY package*.json ./

# Install dependencies (omit devDependencies in production)
RUN npm install --omit=dev

# Copy source code
COPY . .

# Run the actor
CMD npm start
