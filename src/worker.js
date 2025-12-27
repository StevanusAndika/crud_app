export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Rate limiting hanya untuk endpoint API (kecuali GET)
    if (path.startsWith('/api/items') && method !== 'GET') {
      const rateLimitResult = await checkRateLimit(request, env);
      if (rateLimitResult.limited) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }
    }

    // API Routes
    if (path.startsWith('/api/items')) {
      return handleItemsAPI(request, env.DB, corsHeaders);
    }

    // Serve HTML for root path
    if (path === '/') {
      return new Response(getHTML(), {
        headers: {
          'Content-Type': 'text/html',
          ...corsHeaders,
        },
      });
    }

    // Serve schema SQL
    if (path === '/schema.sql') {
      return new Response(getSchemaSQL(), {
        headers: {
          'Content-Type': 'text/sql',
          ...corsHeaders,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  },
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 1000; // 1 detik dalam milidetik
const MAX_REQUESTS_PER_WINDOW = 2; // Maksimal 2 request per window

// Fungsi untuk rate limiting
async function checkRateLimit(request, env) {
  try {
    // Dapatkan IP address client
    const clientIP = request.headers.get('CF-Connecting-IP') || 
                     request.headers.get('X-Forwarded-For') || 
                     'anonymous';
    
    // Buat key unik berdasarkan IP dan timestamp window
    const now = Date.now();
    const windowKey = Math.floor(now / RATE_LIMIT_WINDOW);
    const rateLimitKey = `rate_limit:${clientIP}:${windowKey}`;
    
    // Gunakan KV untuk rate limiting
    if (env.RATE_LIMIT_KV) {
      // Coba increment counter di KV
      const kv = env.RATE_LIMIT_KV;
      let currentCount = await kv.get(rateLimitKey, { type: 'text' });
      
      if (!currentCount) {
        // Jika tidak ada entry, buat baru dengan TTL 2 detik (lebih lama dari window)
        await kv.put(rateLimitKey, '1', { expirationTtl: 2 });
        currentCount = 1;
      } else {
        currentCount = parseInt(currentCount);
        if (currentCount >= MAX_REQUESTS_PER_WINDOW) {
          return {
            limited: true,
            resetTime: (windowKey + 1) * RATE_LIMIT_WINDOW
          };
        }
        // Increment counter
        await kv.put(rateLimitKey, (currentCount + 1).toString(), { expirationTtl: 2 });
      }
    } else {
      // Fallback ke in-memory rate limiting jika KV tidak tersedia
      // PERHATIAN: Ini hanya untuk development, tidak untuk production
      console.warn('RATE_LIMIT_KV not configured, using in-memory rate limiting');
      
      // In-memory store (reset setiap worker restart)
      if (!globalThis.rateLimitStore) {
        globalThis.rateLimitStore = new Map();
      }
      
      const entry = globalThis.rateLimitStore.get(rateLimitKey);
      
      if (!entry) {
        globalThis.rateLimitStore.set(rateLimitKey, {
          count: 1,
          expires: now + RATE_LIMIT_WINDOW * 2
        });
      } else {
        if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
          return {
            limited: true,
            resetTime: (windowKey + 1) * RATE_LIMIT_WINDOW
          };
        }
        entry.count++;
      }
      
      // Cleanup expired entries setiap 100 request
      if (Math.random() < 0.01) {
        for (const [key, value] of globalThis.rateLimitStore.entries()) {
          if (value.expires < now) {
            globalThis.rateLimitStore.delete(key);
          }
        }
      }
    }
    
    return { limited: false };
  } catch (error) {
    console.error('Rate limiting error:', error);
    // Jika rate limiting gagal, tetap izinkan request (fail open)
    return { limited: false };
  }
}

async function handleItemsAPI(request, db, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  // Extract ID from path: /api/items/{id}
  const pathParts = path.split('/').filter(part => part.length > 0);
  const id = pathParts.length === 3 ? pathParts[2] : null;

  try {
    switch (method) {
      case 'GET':
        if (id) {
          // Get single item by ID
          const item = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
          if (!item) {
            return new Response(JSON.stringify({ error: 'Item not found' }), {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }
          return new Response(JSON.stringify(item), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        } else {
          // Get all items with pagination
          const searchParams = url.searchParams;
          const page = parseInt(searchParams.get('page') || '1');
          const limit = parseInt(searchParams.get('limit') || '10');
          const offset = (page - 1) * limit;
          
          // Get total count
          const countResult = await db.prepare('SELECT COUNT(*) as total FROM items').first();
          const total = countResult ? countResult.total : 0;
          
          // Get paginated items
          const items = await db.prepare(
            'SELECT * FROM items ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(limit, offset).all();
          
          return new Response(JSON.stringify({
            items: items.results || [],
            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit) || 1
            }
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }

      case 'POST':
        // Create new item
        try {
          const data = await request.json();
          const { name, description } = data;
          
          if (!name || name.trim() === '') {
            return new Response(JSON.stringify({ 
              error: 'Name is required',
              details: 'Please provide a valid name for the item'
            }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }

          const result = await db.prepare(
            'INSERT INTO items (name, description) VALUES (?, ?)'
          ).bind(name.trim(), description ? description.trim() : null).run();

          // Get the created item
          const createdItem = await db.prepare(
            'SELECT * FROM items WHERE id = ?'
          ).bind(result.meta.last_row_id).first();

          return new Response(JSON.stringify({
            success: true,
            message: 'Item created successfully',
            item: createdItem
          }), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        } catch (jsonError) {
          return new Response(JSON.stringify({ 
            error: 'Invalid JSON data',
            details: 'Please provide valid JSON in the request body'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }

      case 'PUT':
        // Update existing item
        if (!id) {
          return new Response(JSON.stringify({ 
            error: 'ID is required',
            details: 'Please provide an item ID in the URL'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }

        try {
          const data = await request.json();
          const { name, description } = data;
          
          if (!name || name.trim() === '') {
            return new Response(JSON.stringify({ 
              error: 'Name is required',
              details: 'Please provide a valid name for the item'
            }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }

          // Check if item exists
          const existingItem = await db.prepare(
            'SELECT * FROM items WHERE id = ?'
          ).bind(id).first();
          
          if (!existingItem) {
            return new Response(JSON.stringify({ 
              error: 'Item not found',
              details: `Item with ID ${id} does not exist`
            }), {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }

          // Update item
          const updateResult = await db.prepare(
            'UPDATE items SET name = ?, description = ? WHERE id = ?'
          ).bind(name.trim(), description ? description.trim() : null, id).run();

          // Get the updated item
          const updatedItem = await db.prepare(
            'SELECT * FROM items WHERE id = ?'
          ).bind(id).first();

          return new Response(JSON.stringify({
            success: true,
            message: 'Item updated successfully',
            item: updatedItem
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        } catch (jsonError) {
          return new Response(JSON.stringify({ 
            error: 'Invalid JSON data',
            details: 'Please provide valid JSON in the request body'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }

      case 'DELETE':
        // Delete item
        if (!id) {
          return new Response(JSON.stringify({ 
            error: 'ID is required',
            details: 'Please provide an item ID in the URL'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }

        // Check if item exists
        const existingItem = await db.prepare(
          'SELECT * FROM items WHERE id = ?'
        ).bind(id).first();
        
        if (!existingItem) {
          return new Response(JSON.stringify({ 
            error: 'Item not found',
            details: `Item with ID ${id} does not exist`
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }

        // Delete item
        await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run();

        return new Response(JSON.stringify({
          success: true,
          message: 'Item deleted successfully',
          deletedItem: existingItem
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });

      default:
        return new Response(JSON.stringify({ 
          error: 'Method not allowed',
          allowed: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
        }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
    }
  } catch (error) {
    console.error('Database error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CRUD App - Cloudflare Worker + D1</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            color: white;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        .header h1 {
            font-size: 2.8rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
        }

        .header p {
            opacity: 0.9;
            font-size: 1.1rem;
            max-width: 600px;
            margin: 0 auto;
            line-height: 1.6;
        }

        .api-info {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 10px;
            padding: 15px;
            margin: 20px auto;
            max-width: 800px;
            border: 1px solid rgba(255,255,255,0.2);
        }

        .api-info h3 {
            margin-bottom: 10px;
            color: white;
        }

        .endpoint {
            background: rgba(0,0,0,0.2);
            padding: 10px;
            border-radius: 5px;
            margin: 5px 0;
            font-family: 'Courier New', monospace;
            color: #fff;
            font-size: 0.9rem;
        }

        .app-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 40px;
        }

        @media (max-width: 1024px) {
            .app-container {
                grid-template-columns: 1fr;
            }
        }

        .panel {
            background: white;
            padding: 30px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15);
            transition: transform 0.3s ease;
        }

        .panel:hover {
            transform: translateY(-5px);
        }

        .panel h2 {
            color: #2d3748;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e2e8f0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .panel h2 i {
            color: #667eea;
        }

        .form-group {
            margin-bottom: 25px;
        }

        label {
            display: block;
            margin-bottom: 10px;
            font-weight: 600;
            color: #4a5568;
            font-size: 1rem;
        }

        .required::after {
            content: " *";
            color: #e53e3e;
        }

        input, textarea {
            width: 100%;
            padding: 14px;
            border: 2px solid #e2e8f0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            background: #f8fafc;
        }

        input:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
            background: white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        textarea {
            min-height: 120px;
            resize: vertical;
            line-height: 1.5;
        }

        .btn-group {
            display: flex;
            gap: 12px;
            margin-top: 25px;
            flex-wrap: wrap;
        }

        button {
            padding: 14px 28px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-width: 140px;
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        button i {
            font-size: 1.1em;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            flex: 1;
        }

        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
            background: #48bb78;
            color: white;
        }

        .btn-secondary:hover:not(:disabled) {
            background: #38a169;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(72, 187, 120, 0.3);
        }

        .btn-update {
            background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
            color: white;
        }

        .btn-update:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(237, 137, 54, 0.3);
        }

        .btn-danger {
            background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
            color: white;
        }

        .btn-danger:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(245, 101, 101, 0.3);
        }

        .btn-cancel {
            background: #a0aec0;
            color: white;
        }

        .btn-cancel:hover:not(:disabled) {
            background: #718096;
            transform: translateY(-2px);
        }

        .item-list-container {
            max-height: 600px;
            overflow-y: auto;
            padding-right: 10px;
        }

        .item-list-container::-webkit-scrollbar {
            width: 8px;
        }

        .item-list-container::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 4px;
        }

        .item-list-container::-webkit-scrollbar-thumb {
            background: #cbd5e0;
            border-radius: 4px;
        }

        .item-list-container::-webkit-scrollbar-thumb:hover {
            background: #a0aec0;
        }

        .list-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 15px;
        }

        .search-box {
            flex: 1;
            min-width: 250px;
            position: relative;
        }

        .search-box input {
            padding-left: 40px;
        }

        .search-box i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: #a0aec0;
        }

        .stats {
            color: #718096;
            font-size: 0.9rem;
            background: #f7fafc;
            padding: 8px 15px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }

        .item-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.3s;
            position: relative;
            overflow: hidden;
        }

        .item-card:hover {
            transform: translateX(5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            border-color: #cbd5e0;
        }

        .item-card.editing {
            border-color: #ed8936;
            background: #fffaf0;
        }

        .item-id {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #667eea;
            color: white;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .item-card h3 {
            color: #2d3748;
            margin-bottom: 10px;
            font-size: 1.3rem;
            padding-right: 60px;
        }

        .item-card p {
            color: #718096;
            margin-bottom: 15px;
            line-height: 1.6;
            font-size: 1rem;
        }

        .item-card .meta {
            font-size: 0.85rem;
            color: #a0aec0;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .item-card .meta i {
            font-size: 0.9em;
        }

        .item-actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .item-actions button {
            padding: 8px 16px;
            font-size: 0.9rem;
            min-width: auto;
            flex: 1;
        }

        .alert {
            padding: 16px 20px;
            border-radius: 10px;
            margin-bottom: 25px;
            display: none;
            animation: slideIn 0.3s ease;
            border-left: 4px solid;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .alert-success {
            background: #f0fff4;
            color: #22543d;
            border-left-color: #48bb78;
        }

        .alert-error {
            background: #fff5f5;
            color: #742a2a;
            border-left-color: #f56565;
        }

        .alert-info {
            background: #ebf8ff;
            color: #2c5282;
            border-left-color: #4299e1;
        }

        .alert-warning {
            background: #fffaf0;
            color: #744210;
            border-left-color: #ed8936;
        }

        .loading {
            text-align: center;
            padding: 40px 20px;
            color: #667eea;
            font-size: 1.1rem;
        }

        .loading i {
            font-size: 2em;
            margin-bottom: 15px;
            display: block;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            100% { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            padding: 50px 20px;
            color: #a0aec0;
        }

        .empty-state i {
            font-size: 3em;
            margin-bottom: 15px;
            color: #cbd5e0;
        }

        .json-panel {
            grid-column: 1 / -1;
            margin-top: 20px;
        }

        .json-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .json-output {
            background: #1a202c;
            color: #e2e8f0;
            border-radius: 10px;
            padding: 20px;
            font-family: 'Fira Code', 'Courier New', monospace;
            font-size: 14px;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
            line-height: 1.5;
        }

        .json-output::-webkit-scrollbar {
            width: 8px;
        }

        .json-output::-webkit-scrollbar-track {
            background: #2d3748;
            border-radius: 4px;
        }

        .json-output::-webkit-scrollbar-thumb {
            background: #4a5568;
            border-radius: 4px;
        }

        .copy-btn {
            background: #4a5568;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 0.9rem;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .copy-btn:hover {
            background: #2d3748;
        }

        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }

        .pagination button {
            min-width: 40px;
            padding: 8px 12px;
            background: #edf2f7;
            color: #4a5568;
            border: 1px solid #e2e8f0;
        }

        .pagination button:hover:not(:disabled) {
            background: #e2e8f0;
        }

        .pagination button.active {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }

        .footer {
            text-align: center;
            color: white;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .rate-limit-info {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 10px 15px;
            margin-top: 10px;
            font-size: 0.9rem;
            border-left: 3px solid #ed8936;
        }

        @media (max-width: 768px) {
            body {
                padding: 15px;
            }
            
            .header h1 {
                font-size: 2rem;
                flex-direction: column;
                gap: 10px;
            }
            
            .panel {
                padding: 20px;
            }
            
            .btn-group {
                flex-direction: column;
            }
            
            button {
                width: 100%;
            }
            
            .list-controls {
                flex-direction: column;
                align-items: stretch;
            }
            
            .search-box {
                min-width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                <i class="fas fa-database"></i>
                CRUD App with Rate Limiter
                <i class="fas fa-server"></i>
            </h1>
            <p>Cloudflare Worker + D1 Database | Rate Limit: 2 requests/second for POST/PUT/DELETE</p>
            
            <div class="api-info">
                <h3><i class="fas fa-code"></i> API Endpoints</h3>
                <div class="endpoint">GET <strong>/api/items</strong> - Get all items (with pagination: ?page=1&limit=10)</div>
                <div class="endpoint">GET <strong>/api/items/:id</strong> - Get single item by ID</div>
                <div class="endpoint">POST <strong>/api/items</strong> - Create new item <span style="color:#ed8936;">(Rate Limited)</span></div>
                <div class="endpoint">PUT <strong>/api/items/:id</strong> - Update item by ID <span style="color:#ed8936;">(Rate Limited)</span></div>
                <div class="endpoint">DELETE <strong>/api/items/:id</strong> - Delete item by ID <span style="color:#ed8936;">(Rate Limited)</span></div>
                
                <div class="rate-limit-info">
                    <i class="fas fa-exclamation-triangle"></i> 
                    <strong>Rate Limiting Active:</strong> Maximum 2 requests per second for POST, PUT, DELETE operations. GET requests are not limited.
                </div>
            </div>
        </div>

        <div id="alert" class="alert"></div>

        <div class="app-container">
            <div class="panel">
                <h2><i class="fas fa-edit"></i> Create/Update Item</h2>
                <form id="itemForm">
                    <input type="hidden" id="itemId">
                    <div class="form-group">
                        <label for="name" class="required">Name</label>
                        <input type="text" id="name" required placeholder="Enter item name">
                    </div>
                    <div class="form-group">
                        <label for="description">Description</label>
                        <textarea id="description" placeholder="Enter item description"></textarea>
                    </div>
                    <div class="btn-group">
                        <button type="submit" class="btn-primary" id="submitBtn">
                            <i class="fas fa-plus"></i> Create Item
                        </button>
                        <button type="button" class="btn-update" id="updateBtn" style="display: none;">
                            <i class="fas fa-save"></i> Update Item
                        </button>
                        <button type="button" class="btn-cancel" id="cancelBtn" style="display: none;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </form>
            </div>

            <div class="panel">
                <div class="list-controls">
                    <h2 style="margin: 0; border: none; padding: 0;"><i class="fas fa-list"></i> Items List</h2>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" id="searchInput" placeholder="Search items...">
                    </div>
                    <button class="btn-secondary" onclick="loadItems()" id="refreshBtn">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                
                <div class="stats" id="stats">Loading...</div>
                
                <div class="item-list-container" id="itemListContainer">
                    <div class="item-list" id="itemList">
                        <div class="loading">
                            <i class="fas fa-spinner"></i>
                            Loading items...
                        </div>
                    </div>
                </div>
                
                <div class="pagination" id="pagination" style="display: none;">
                    <button onclick="changePage(-1)" id="prevBtn"><i class="fas fa-chevron-left"></i></button>
                    <span id="pageInfo">Page 1 of 1</span>
                    <button onclick="changePage(1)" id="nextBtn"><i class="fas fa-chevron-right"></i></button>
                </div>
            </div>

            <div class="panel json-panel">
                <div class="json-header">
                    <h2><i class="fas fa-code"></i> API Response</h2>
                    <button class="copy-btn" onclick="copyJSON()">
                        <i class="far fa-copy"></i> Copy JSON
                    </button>
                </div>
                <div class="json-output" id="jsonOutput">
                    // API response will appear here...
                </div>
            </div>
        </div>

        <div class="footer">
            <p>Built with Cloudflare Workers + D1 Database | REST API CRUD Application with Rate Limiting</p>
            <p>Database Schema: <code>items(id, name, description, created_at)</code> | Rate Limit: 2 req/sec for write operations</p>
        </div>
    </div>

    <script>
        const API_BASE_URL = window.location.origin + '/api/items';
        let currentEditId = null;
        let currentItems = [];
        let currentPage = 1;
        const itemsPerPage = 5;
        let totalPages = 1;
        let searchQuery = '';

        // DOM Elements
        const itemForm = document.getElementById('itemForm');
        const itemList = document.getElementById('itemList');
        const itemListContainer = document.getElementById('itemListContainer');
        const alertDiv = document.getElementById('alert');
        const jsonOutput = document.getElementById('jsonOutput');
        const submitBtn = document.getElementById('submitBtn');
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const searchInput = document.getElementById('searchInput');
        const refreshBtn = document.getElementById('refreshBtn');
        const paginationDiv = document.getElementById('pagination');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const pageInfo = document.getElementById('pageInfo');
        const stats = document.getElementById('stats');

        // Show alert message
        function showAlert(message, type = 'success') {
            alertDiv.textContent = message;
            alertDiv.className = 'alert alert-' + type;
            alertDiv.style.display = 'block';
            
            // Auto-hide success messages after 5 seconds
            if (type === 'success') {
                setTimeout(() => {
                    alertDiv.style.display = 'none';
                }, 5000);
            }
        }

        // Update JSON output display
        function updateJsonOutput(data) {
            jsonOutput.textContent = JSON.stringify(data, null, 2);
        }

        // Copy JSON to clipboard
        function copyJSON() {
            navigator.clipboard.writeText(jsonOutput.textContent)
                .then(() => showAlert('JSON copied to clipboard!', 'success'))
                .catch(err => showAlert('Failed to copy JSON: ' + err, 'error'));
        }

        // Load all items with pagination
        async function loadItems(page = 1) {
            try {
                currentPage = page;
                itemList.innerHTML = '<div class="loading"><i class="fas fa-spinner"></i>Loading items...</div>';
                refreshBtn.disabled = true;
                
                // Build URL with pagination
                let url = API_BASE_URL + '?page=' + page + '&limit=' + itemsPerPage;
                
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                
                const data = await response.json();
                currentItems = data.items || [];
                totalPages = data.pagination?.pages || 1;
                
                // Update stats
                stats.textContent = 'Showing ' + currentItems.length + ' of ' + (data.pagination?.total || 0) + ' items';
                
                if (currentItems.length === 0) {
                    itemList.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><h3>No items found</h3><p>Create your first item using the form!</p></div>';
                    paginationDiv.style.display = 'none';
                    updateJsonOutput(data);
                    return;
                }

                // Apply search filter if any
                let filteredItems = currentItems;
                if (searchQuery) {
                    const query = searchQuery.toLowerCase();
                    filteredItems = currentItems.filter(item => 
                        item.name.toLowerCase().includes(query) || 
                        (item.description && item.description.toLowerCase().includes(query))
                    );
                }

                // Render items
                itemList.innerHTML = '';
                filteredItems.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'item-card' + (currentEditId === item.id ? ' editing' : '');
                    itemDiv.innerHTML = '<div class="item-id">#' + item.id + '</div>' +
                                        '<h3>' + escapeHtml(item.name) + '</h3>' +
                                        '<p>' + (item.description ? escapeHtml(item.description) : '<em>No description</em>') + '</p>' +
                                        '<div class="meta">' +
                                        '<span><i class="far fa-clock"></i> Created: ' + new Date(item.created_at).toLocaleDateString() + '</span>' +
                                        '<span><i class="far fa-calendar"></i> ' + new Date(item.created_at).toLocaleTimeString() + '</span>' +
                                        '</div>' +
                                        '<div class="item-actions">' +
                                        '<button class="btn-update" onclick="editItem(' + item.id + ')"><i class="fas fa-edit"></i> Edit</button>' +
                                        '<button class="btn-danger" onclick="deleteItem(' + item.id + ')"><i class="fas fa-trash"></i> Delete</button>' +
                                        '</div>';
                    itemList.appendChild(itemDiv);
                });

                // Update pagination controls
                updatePagination();
                updateJsonOutput(data);
                
            } catch (error) {
                console.error('Error loading items:', error);
                itemList.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error loading items</h3><p>' + error.message + '</p></div>';
                showAlert('Error loading items: ' + error.message, 'error');
                updateJsonOutput({ error: error.message });
            } finally {
                refreshBtn.disabled = false;
            }
        }

        // Update pagination controls
        function updatePagination() {
            if (totalPages <= 1) {
                paginationDiv.style.display = 'none';
                return;
            }
            
            paginationDiv.style.display = 'flex';
            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = currentPage >= totalPages;
            pageInfo.textContent = 'Page ' + currentPage + ' of ' + totalPages;
        }

        // Change page
        function changePage(delta) {
            const newPage = currentPage + delta;
            if (newPage >= 1 && newPage <= totalPages) {
                loadItems(newPage);
            }
        }

        // Escape HTML to prevent XSS
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Edit item function
        async function editItem(id) {
            try {
                showAlert('Loading item details...', 'info');
                
                const response = await fetch(API_BASE_URL + '/' + id);
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                
                const item = await response.json();
                
                if (item.error) {
                    showAlert(item.error, 'error');
                    return;
                }

                currentEditId = id;
                document.getElementById('itemId').value = id;
                document.getElementById('name').value = item.name;
                document.getElementById('description').value = item.description || '';
                
                // Show update button, hide submit button
                submitBtn.style.display = 'none';
                updateBtn.style.display = 'block';
                cancelBtn.style.display = 'block';
                
                updateJsonOutput(item);
                showAlert('Now editing item #' + id + ' - "' + item.name + '"', 'info');
                
                // Highlight the item being edited
                loadItems(currentPage);
                
            } catch (error) {
                console.error('Error loading item:', error);
                showAlert('Error loading item: ' + error.message, 'error');
            }
        }

        // Handle form submission for create/update
        itemForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('itemId').value;
            const name = document.getElementById('name').value.trim();
            const description = document.getElementById('description').value.trim();

            if (!name) {
                showAlert('Name is required!', 'error');
                return;
            }

            const itemData = { 
                name: name, 
                description: description || null 
            };
            
            const isUpdate = !!currentEditId;
            
            // Disable buttons during request
            submitBtn.disabled = true;
            updateBtn.disabled = true;

            try {
                let response, result;
                
                if (isUpdate) {
                    // Update existing item
                    showAlert('Updating item...', 'info');
                    response = await fetch(API_BASE_URL + '/' + currentEditId, {
                        method: 'PUT',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(itemData)
                    });
                    result = await response.json();
                    
                    if (response.ok) {
                        showAlert('✅ Item updated successfully!', 'success');
                    } else if (response.status === 429) {
                        // Rate limit exceeded
                        throw new Error('Rate limit exceeded: ' + (result.message || 'Too many requests'));
                    } else {
                        throw new Error(result.error || 'Update failed with status ' + response.status);
                    }
                } else {
                    // Create new item
                    showAlert('Creating item...', 'info');
                    response = await fetch(API_BASE_URL, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(itemData)
                    });
                    result = await response.json();
                    
                    if (response.status === 201) {
                        showAlert('✅ Item created successfully!', 'success');
                    } else if (response.status === 429) {
                        // Rate limit exceeded
                        throw new Error('Rate limit exceeded: ' + (result.message || 'Too many requests'));
                    } else {
                        throw new Error(result.error || 'Creation failed with status ' + response.status);
                    }
                }

                updateJsonOutput(result);
                
                // Reset form and reload items
                resetForm();
                loadItems();
                
            } catch (error) {
                console.error('Error saving item:', error);
                if (error.message.includes('Rate limit exceeded')) {
                    showAlert('⚠️ Rate Limit Exceeded: ' + error.message + '. Please wait a moment and try again.', 'warning');
                } else {
                    showAlert('❌ Error: ' + error.message, 'error');
                }
                updateJsonOutput({ error: error.message });
            } finally {
                submitBtn.disabled = false;
                updateBtn.disabled = false;
            }
        });

        // Add click handler for update button
        updateBtn.addEventListener('click', (e) => {
            // Trigger form submission
            itemForm.dispatchEvent(new Event('submit'));
        });

        // Delete item
        async function deleteItem(id) {
            if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
                return;
            }

            const deleteBtn = event?.target || document.querySelector('button[onclick="deleteItem(' + id + ')"]');
            if (deleteBtn) deleteBtn.disabled = true;

            try {
                showAlert('Deleting item...', 'info');
                const response = await fetch(API_BASE_URL + '/' + id, {
                    method: 'DELETE'
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert('🗑️ Item deleted successfully!', 'success');
                    updateJsonOutput(result);
                    
                    // If we're editing this item, cancel edit
                    if (currentEditId === id) {
                        resetForm();
                    }
                    
                    // Reload items
                    loadItems(currentPage);
                } else if (response.status === 429) {
                    // Rate limit exceeded
                    throw new Error('Rate limit exceeded: ' + (result.message || 'Too many requests'));
                } else {
                    throw new Error(result.error || 'Delete failed with status ' + response.status);
                }
                
            } catch (error) {
                console.error('Error deleting item:', error);
                if (error.message.includes('Rate limit exceeded')) {
                    showAlert('⚠️ Rate Limit Exceeded: ' + error.message + '. Please wait a moment and try again.', 'warning');
                } else {
                    showAlert('❌ Error deleting item: ' + error.message, 'error');
                }
                updateJsonOutput({ error: error.message });
            } finally {
                if (deleteBtn) deleteBtn.disabled = false;
            }
        }

        // Reset form
        function resetForm() {
            itemForm.reset();
            currentEditId = null;
            document.getElementById('itemId').value = '';
            submitBtn.style.display = 'block';
            updateBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            
            // Remove editing highlight
            loadItems(currentPage);
        }

        // Cancel edit
        cancelBtn.addEventListener('click', resetForm);

        // Search functionality
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadItems(1);
            }, 300);
        });

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            loadItems();
            
            // Test API connection
            fetch(API_BASE_URL)
                .then(response => {
                    if (response.ok) {
                        showAlert('✅ Connected to API successfully', 'success');
                    } else {
                        showAlert('⚠️ API responded with status: ' + response.status, 'error');
                    }
                })
                .catch(err => showAlert('❌ API connection error: ' + err.message, 'error'));
        });

        // Make functions available globally for onclick handlers
        window.loadItems = loadItems;
        window.editItem = editItem;
        window.deleteItem = deleteItem;
        window.changePage = changePage;
        window.copyJSON = copyJSON;
    </script>
</body>
</html>`;
}

function getSchemaSQL() {
  
}