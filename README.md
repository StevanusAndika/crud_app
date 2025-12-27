# 📝 CRUD App dengan Cloudflare Workers + D1 Database

Aplikasi CRUD sederhana yang dibangun menggunakan Cloudflare Workers dan D1 Database, dengan frontend HTML/CSS/JS native dan output API dalam format JSON.

## 🚀 Fitur Utama

- ✅ **CRUD Lengkap**: Create, Read, Update, Delete operations
- ✅ **Database D1**: SQLite-based database dari Cloudflare
- ✅ **API JSON**: Semua endpoint mengembalikan data dalam format JSON
- ✅ **Frontend Native**: HTML, CSS, dan JavaScript tanpa framework
- ✅ **Responsive Design**: Tampilan yang optimal di desktop dan mobile
- ✅ **Real-time Updates**: Update data secara real-time
- ✅ **GitHub Integration**: Hosting kode di GitHub dengan CI/CD opsional
- ✅ **CORS Support**: Mendukung Cross-Origin Resource Sharing

## 🏗️ Arsitektur Sistem

```
Frontend (HTML/CSS/JS)
        ↓
Cloudflare Workers (Serverless)
        ↓
D1 Database (SQLite)
```

## 📁 Struktur Proyek

```
crud-worker-d1/
├── src/
│   ├── worker.js          # Cloudflare Worker code
│   └── index.html         # Frontend HTML (embedded dalam worker)
├── schema.sql            # SQL schema untuk database
├── wrangler.toml         # Konfigurasi Wrangler
├── package.json          # Dependencies dan scripts
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions workflow
└── README.md             # Dokumentasi ini
```

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) (v18 atau lebih tinggi)
- [npm](https://www.npmjs.com/) atau [yarn](https://yarnpkg.com/)
- [Git](https://git-scm.com/)
- Akun [Cloudflare](https://dash.cloudflare.com/)
- Akun [GitHub](https://github.com/)

## 🚀 Setup dan Deployment

### 1. Clone dan Setup Awal

```bash
# Clone repository
git clone <your-repository-url>
cd crud-worker-d1

# Install dependencies
npm install
```

### 2. Login ke Cloudflare

```bash
# Login menggunakan Wrangler CLI
npx wrangler login

# Ikuti instruksi di browser untuk autentikasi
```

### 3. Setup D1 Database

```bash
# Buat database D1 baru
npx wrangler d1 create crud-db

# Database ID akan ditampilkan, copy ke wrangler.toml
# Contoh: database_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

### 4. Konfigurasi Database

Edit file `wrangler.toml`:
```toml
name = "crud-worker-d1"
main = "src/worker.js"
compatibility_date = "2024-07-01"

[[d1_databases]]
binding = "DB"
database_name = "crud-db"
database_id = "YOUR_DATABASE_ID"  # Ganti dengan ID Anda
```

### 5. Inisialisasi Database Schema

```bash
# Apply schema ke database lokal (development)
npx wrangler d1 execute crud-db --local --file=./schema.sql

# Apply schema ke database production
npx wrangler d1 execute crud-db --file=./schema.sql
```

### 6. Development Mode

```bash
# Jalankan di mode development
npm run dev

# Aplikasi akan tersedia di http://localhost:8787
```

### 7. Deploy ke Production

```bash
# Deploy ke Cloudflare Workers
npm run deploy

# Worker akan tersedia di URL unik Cloudflare
```

## 📚 API Endpoints

### Items CRUD API

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/api/items` | Get all items | - | `[{id, name, description, created_at}]` |
| GET | `/api/items/:id` | Get single item | - | `{id, name, description, created_at}` |
| POST | `/api/items` | Create new item | `{name, description}` | `{id, message}` |
| PUT | `/api/items/:id` | Update item | `{name, description}` | `{message}` |
| DELETE | `/api/items/:id` | Delete item | - | `{message}` |

### Contoh Request API

**Create Item:**
```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/api/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Item","description":"Test Description"}'
```

**Get All Items:**
```bash
curl https://your-worker.your-subdomain.workers.dev/api/items
```

**Update Item:**
```bash
curl -X PUT https://your-worker.your-subdomain.workers.dev/api/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Item","description":"Updated Description"}'
```

**Delete Item:**
```bash
curl -X DELETE https://your-worker.your-subdomain.workers.dev/api/items/1
```

## 🔧 GitHub Actions Setup (Opsional)

### 1. Buat Secrets di GitHub Repository

1. Buka repository di GitHub
2. Navigasi ke **Settings → Secrets and variables → Actions**
3. Tambahkan secret baru:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: Dapatkan dari [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)

### 2. Push ke GitHub

```bash
git add .
git commit -m "Setup complete"
git push origin main
```

### 3. Automatic Deployment

Setiap push ke branch `main` akan memicu deployment otomatis melalui GitHub Actions.

## 🎨 Frontend Features

### Interface Elements:
1. **Form Create/Update Item**
   - Input fields untuk name dan description
   - Dynamic buttons (Create/Update/Cancel)

2. **Items List**
   - Display semua items dengan card design
   - Action buttons untuk edit dan delete
   - Real-time refresh

3. **JSON Output Panel**
   - Menampilkan response API dalam format JSON
   - Berguna untuk debugging

4. **Alert System**
   - Success/error notifications
   - Auto-hide setelah 5 detik

### Styling Features:
- Modern gradient background
- Responsive grid layout
- Interactive hover effects
- Mobile-friendly design

## 🗄️ Database Schema

```sql
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔍 Testing

### Manual Testing:
1. Buka URL worker di browser
2. Coba operasi CRUD melalui form
3. Verifikasi data di JSON output panel

### Automated Testing (Opsional):
```bash
# Install testing dependencies
npm install --save-dev jest wrangler

# Run tests
npm test
```

## 🚨 Troubleshooting

### Common Issues:

1. **Database Connection Error**
   - Verifikasi `database_id` di `wrangler.toml`
   - Cek apakah database sudah dibuat: `wrangler d1 list`

2. **CORS Errors**
   - Pastikan headers CORS sudah di-set di worker
   - Cek browser console untuk detail error

3. **Deployment Failed**
   - Verifikasi Cloudflare API token
   - Cek logs di Cloudflare Dashboard
   - Run `wrangler deploy --verbose` untuk detail error

4. **Local Development Issues**
   - Pastikan Wrangler versi terbaru: `npm update wrangler`
   - Clear cache: `wrangler dev --clear`

### Logs dan Monitoring:

```bash
# View production logs
wrangler tail

# View specific worker logs
wrangler tail --format=pretty

# Monitor metrics
# Buka Cloudflare Dashboard → Workers & Pages → Analytics
```

## 📈 Monitoring dan Analytics

### Cloudflare Dashboard:
1. **Workers Analytics**: Request count, CPU time, errors
2. **D1 Analytics**: Query count, rows read/written
3. **Real-time Logs**: Live request monitoring

### Custom Metrics:
Tambahkan di `worker.js` untuk custom tracking:
```javascript
// Contoh: Track successful operations
await env.DB.prepare('INSERT INTO audit_logs (action, data) VALUES (?, ?)')
  .bind('CREATE_ITEM', JSON.stringify(itemData))
  .run();
```

## 🔒 Security Considerations

1. **Input Validation**: Validasi semua input di server-side
2. **SQL Injection Protection**: Gunakan prepared statements dengan D1
3. **Rate Limiting**: Implement rate limiting jika perlu
4. **API Authentication**: Tambahkan auth untuk production use

## 📱 Mobile Support

Aplikasi fully responsive dengan:
- Mobile-first design approach
- Touch-friendly buttons
- Optimal viewport scaling
- Gesture support untuk actions

## 🔄 Future Enhancements

### Planned Features:
1. [ ] User authentication
2. [ ] Advanced filtering and search
3. [ ] Bulk operations
4. [ ] Export to CSV/JSON
5. [ ] Offline support
6. [ ] File attachments
7. [ ] Real-time collaboration

### Performance Optimizations:
1. [ ] Database indexing
2. [ ] Response caching
3. [ ] Lazy loading
4. [ ] Code splitting

## 🤝 Contributing

1. Fork repository
2. Buat feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push ke branch: `git push origin feature/new-feature`
5. Submit pull request

## 📄 License

MIT License - lihat [LICENSE](LICENSE) file untuk detail

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/crud-worker-d1/issues)
- **Documentation**: [Cloudflare Docs](https://developers.cloudflare.com/)
- **Community**: [Cloudflare Discord](https://discord.cloudflare.com/)

---

**Note**: Pastikan untuk mengganti placeholder values (`YOUR_DATABASE_ID`, `yourusername`, dll) dengan nilai sebenarnya sebelum deployment.