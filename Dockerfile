FROM nginx:alpine

# Serve on 8080, the port Cloud Run sends traffic to by default.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy only what belongs in the public web root. Listing the files
# explicitly (rather than `COPY .`) keeps the course materials, the
# development log and the build files themselves out of the image.
COPY index.html /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
