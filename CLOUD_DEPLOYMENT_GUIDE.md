# Cloud Deployment Guide

This ERP has three cloud parts:

1. MySQL database
2. Backend API
3. Frontend website

Recommended setup for verification:

- Database: Aiven for MySQL
- Backend API: Render Web Service
- Frontend: Vercel Vite site

## 1. Push The Project To GitHub

Create a GitHub repository and push this folder.

Use the repository root, not only the frontend or backend folder.

## 2. Create The Cloud MySQL Database

Use Aiven for MySQL or any managed MySQL 8 compatible service.

Create a MySQL service and keep these connection values:

- Host
- Port
- User
- Password
- Database name

If the provider gives the default database name as `defaultdb`, use that as `DB_NAME`.

## 3. Import The Local ERP Database

Export the local database:

```bash
mysqldump -u root -p ev_motor_erp > ev_motor_erp_cloud.sql
```

Import it into the cloud database:

```bash
mysql -h CLOUD_DB_HOST -P CLOUD_DB_PORT -u CLOUD_DB_USER -p CLOUD_DB_NAME < ev_motor_erp_cloud.sql
```

For Aiven, use the host, port, username, password, and database shown in the Quick Connect panel.

## 4. Deploy Backend API On Render

In Render:

1. Choose New > Blueprint.
2. Connect your GitHub repository.
3. Render will read `render.yaml`.
4. Enter these secret values when Render asks:

```text
DB_HOST=your-cloud-mysql-host
DB_PORT=your-cloud-mysql-port
DB_USER=your-cloud-mysql-user
DB_PASSWORD=your-cloud-mysql-password
DB_NAME=your-cloud-mysql-database
CORS_ORIGINS=https://your-frontend-domain.vercel.app
```

After deploy, Render gives an API URL like:

```text
https://ev-motor-erp-api.onrender.com
```

Test it in the browser:

```text
https://ev-motor-erp-api.onrender.com/
```

Expected response:

```json
{ "message": "EV Motor Manufacturing ERP API is running." }
```

## 5. Deploy Frontend On Vercel

In Vercel:

1. Import the same GitHub repository.
2. Set Root Directory to `frontend`.
3. Use Framework Preset `Vite`.
4. Add this environment variable:

```text
VITE_API_BASE_URL=https://your-render-api-url.onrender.com/api
```

5. Deploy.

After deploy, Vercel gives a frontend URL like:

```text
https://ev-motor-erp.vercel.app
```

## 6. Update Render CORS

After Vercel gives the final frontend URL, go back to Render and update:

```text
CORS_ORIGINS=https://your-final-vercel-url.vercel.app
```

Then redeploy the Render backend.

## 7. Verification Checklist

- Backend URL opens and returns the API running message.
- Frontend URL opens the ERP login page.
- Login works with a seeded ERP user account.
- Dashboard loads.
- Inventory Analytics loads.
- Forecast cards are visible.
- Import templates still download.

## Important Notes

- Do not put `.env` files into GitHub.
- Do not paste database passwords into code.
- Use cloud environment variables for database credentials.
- The frontend must use the backend `/api` URL.
- The backend must allow the frontend URL in `CORS_ORIGINS`.
