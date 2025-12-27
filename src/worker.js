export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (path.startsWith('/api/items')) {
      return handleItemsAPI(request, env.DB, corsHeaders);
    }

    // Serve HTML
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html', ...corsHeaders },
    });
  },
};

async function handleItemsAPI(request, db, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const id = path.split('/')[3];

  try {
    switch (method) {
      case 'GET':
        if (id) {
          const item = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
          return jsonResponse(item || { error: 'Item not found' }, corsHeaders);
        } else {
          const items = await db.prepare('SELECT * FROM items ORDER BY created_at DESC').all();
          return jsonResponse(items.results, corsHeaders);
        }

      case 'POST':
        const { name, description } = await request.json();
        if (!name) return jsonResponse({ error: 'Name is required' }, corsHeaders, 400);
        
        const result = await db.prepare('INSERT INTO items (name, description) VALUES (?, ?)')
          .bind(name, description).run();
        
        return jsonResponse({ 
          id: result.meta.last_row_id, 
          name, 
          description,
          message: 'Item created successfully' 
        }, corsHeaders, 201);

      case 'PUT':
        if (!id) return jsonResponse({ error: 'ID is required' }, corsHeaders, 400);
        
        const { name: updateName, description: updateDesc } = await request.json();
        
        // Cek jika item exists
        const existing = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
        if (!existing) return jsonResponse({ error: 'Item not found' }, corsHeaders, 404);
        
        await db.prepare('UPDATE items SET name = ?, description = ? WHERE id = ?')
          .bind(updateName, updateDesc, id).run();
        
        return jsonResponse({ 
          message: 'Item updated successfully',
          id,
          name: updateName,
          description: updateDesc
        }, corsHeaders);

      case 'DELETE':
        if (!id) return jsonResponse({ error: 'ID is required' }, corsHeaders, 400);
        
        // Cek jika item exists
        const itemToDelete = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
        if (!itemToDelete) return jsonResponse({ error: 'Item not found' }, corsHeaders, 404);
        
        await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
        
        return jsonResponse({ 
          message: 'Item deleted successfully',
          id 
        }, corsHeaders);

      default:
        return jsonResponse({ error: 'Method not allowed' }, corsHeaders, 405);
    }
  } catch (error) {
    return jsonResponse({ error: error.message }, corsHeaders, 500);
  }
}

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CRUD App with SweetAlert</title>
    
    <!-- SweetAlert CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.2);
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }

        .header h1 {
            color: #2c3e50;
            font-size: 2.8rem;
            margin-bottom: 10px;
            background: linear-gradient(90deg, #6a11cb, #2575fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header p {
            color: #7f8c8d;
            font-size: 1.1rem;
        }

        .app-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
        }

        @media (max-width: 900px) {
            .app-grid {
                grid-template-columns: 1fr;
            }
        }

        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
            border: 1px solid #e0e0e0;
        }

        .card h2 {
            color: #2c3e50;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #2c3e50;
        }

        .form-control {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #ddd;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            background: #f8f9fa;
        }

        .form-control:focus {
            outline: none;
            border-color: #6a11cb;
            background: white;
            box-shadow: 0 0 0 3px rgba(106, 17, 203, 0.1);
        }

        textarea.form-control {
            min-height: 120px;
            resize: vertical;
            font-family: inherit;
        }

        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .btn-primary {
            background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 14px rgba(106, 17, 203, 0.3);
        }

        .btn-success {
            background: linear-gradient(135deg, #00b09b 0%, #96c93d 100%);
            color: white;
        }

        .btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 14px rgba(0, 176, 155, 0.3);
        }

        .btn-danger {
            background: linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%);
            color: white;
        }

        .btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 14px rgba(255, 65, 108, 0.3);
        }

        .btn-warning {
            background: linear-gradient(135deg, #f7971e 0%, #ffd200 100%);
            color: white;
        }

        .btn-warning:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 14px rgba(247, 151, 30, 0.3);
        }

        .btn-secondary {
            background: #95a5a6;
            color: white;
        }

        .btn-secondary:hover {
            background: #7f8c8d;
        }

        .btn-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 20px;
        }

        .btn-group .btn {
            flex: 1;
        }

        .item-list {
            max-height: 600px;
            overflow-y: auto;
            padding-right: 10px;
        }

        .item-list::-webkit-scrollbar {
            width: 8px;
        }

        .item-list::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 10px;
        }

        .item-list::-webkit-scrollbar-thumb {
            background: #6a11cb;
            border-radius: 10px;
        }

        .item-card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 15px;
            border-left: 5px solid #6a11cb;
            transition: all 0.3s;
            position: relative;
        }

        .item-card:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            background: white;
        }

        .item-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
        }

        .item-title {
            color: #2c3e50;
            font-size: 1.2rem;
            font-weight: 600;
            margin: 0;
        }

        .item-id {
            background: #e0e0e0;
            color: #7f8c8d;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }

        .item-description {
            color: #5d6d7e;
            line-height: 1.6;
            margin-bottom: 15px;
        }

        .item-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #95a5a6;
            font-size: 13px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #eee;
        }

        .item-date {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .item-actions {
            display: flex;
            gap: 8px;
        }

        .item-actions .btn {
            padding: 8px 16px;
            font-size: 14px;
            flex: none;
        }

        .no-items {
            text-align: center;
            padding: 40px 20px;
            color: #95a5a6;
        }

        .no-items i {
            font-size: 48px;
            margin-bottom: 15px;
            opacity: 0.5;
        }

        .alert {
            padding: 15px 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            display: none;
            animation: slideIn 0.3s ease;
        }

        .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .loading {
            text-align: center;
            padding: 30px;
            color: #6a11cb;
        }

        .loading-spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #6a11cb;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .json-preview {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            max-height: 200px;
            overflow-y: auto;
            white-space: pre-wrap;
        }

        .form-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✨ CRUD Master</h1>
            <p>Cloudflare Workers + D1 Database | Beautiful UI with SweetAlert</p>
        </div>

        <div id="alert" class="alert"></div>

        <div class="app-grid">
            <!-- Form Section -->
            <div class="card">
                <h2>📝 Create / Edit Item</h2>
                <form id="itemForm">
                    <input type="hidden" id="itemId">
                    
                    <div class="form-group">
                        <label for="name">Item Name *</label>
                        <input type="text" id="name" class="form-control" 
                               placeholder="Enter item name" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="description">Description</label>
                        <textarea id="description" class="form-control" 
                                  placeholder="Enter item description..."></textarea>
                    </div>
                    
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary" id="submitBtn">
                            <span>➕ Create Item</span>
                        </button>
                        <button type="button" class="btn btn-success hidden" id="updateBtn">
                            <span>💾 Update Item</span>
                        </button>
                        <button type="button" class="btn btn-secondary hidden" id="cancelBtn">
                            <span>❌ Cancel</span>
                        </button>
                    </div>
                </form>

                <div class="json-preview" id="jsonOutput">
                    <!-- JSON response will appear here -->
                </div>
            </div>

            <!-- List Section -->
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin: 0;">📦 Items List</h2>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-success" onclick="loadItems()">
                            <span>🔄 Refresh</span>
                        </button>
                        <button class="btn btn-secondary" onclick="clearForm()">
                            <span>🧹 Clear Form</span>
                        </button>
                    </div>
                </div>
                
                <div class="item-list" id="itemList">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <p>Loading items...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- SweetAlert JS -->
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    
    <script>
        // Configuration
        const API_BASE_URL = window.location.origin + '/api/items';
        let isEditing = false;
        let currentEditId = null;

        // DOM Elements
        const itemForm = document.getElementById('itemForm');
        const itemList = document.getElementById('itemList');
        const alertDiv = document.getElementById('alert');
        const jsonOutput = document.getElementById('jsonOutput');
        const submitBtn = document.getElementById('submitBtn');
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const nameInput = document.getElementById('name');
        const descInput = document.getElementById('description');
        const itemIdInput = document.getElementById('itemId');

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            loadItems();
            setupEventListeners();
        });

        // Setup event listeners
        function setupEventListeners() {
            // Form submission
            itemForm.addEventListener('submit', handleSubmit);
            
            // Update button
            updateBtn.addEventListener('click', handleUpdate);
            
            // Cancel button
            cancelBtn.addEventListener('click', cancelEdit);
            
            // Real-time JSON preview
            nameInput.addEventListener('input', updateJsonPreview);
            descInput.addEventListener('input', updateJsonPreview);
        }

        // Show SweetAlert notification
        function showSweetAlert(title, text, icon = 'success', confirmButtonText = 'OK') {
            return Swal.fire({
                title: title,
                text: text,
                icon: icon,
                confirmButtonText: confirmButtonText,
                confirmButtonColor: '#6a11cb',
                timer: icon === 'success' ? 3000 : undefined,
                timerProgressBar: icon === 'success',
                showClass: {
                    popup: 'animate__animated animate__fadeInDown'
                },
                hideClass: {
                    popup: 'animate__animated animate__fadeOutUp'
                }
            });
        }

        // Show regular alert
        function showAlert(message, type = 'success') {
            alertDiv.textContent = message;
            alertDiv.className = 'alert alert-' + (type === 'error' ? 'error' : 'success');
            alertDiv.style.display = 'block';
            
            setTimeout(() => {
                alertDiv.style.display = 'none';
            }, 5000);
        }

        // Update JSON preview
        function updateJsonPreview() {
            const data = {
                name: nameInput.value,
                description: descInput.value
            };
            
            if (currentEditId) {
                data.id = currentEditId;
            }
            
            jsonOutput.textContent = JSON.stringify(data, null, 2);
        }

        // Load all items
        async function loadItems() {
            try {
                itemList.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading items...</p></div>';
                
                const response = await fetch(API_BASE_URL);
                
                if (!response.ok) {
                    throw new Error('HTTP error! status: ' + response.status);
                }
                
                const items = await response.json();
                
                if (!items || items.length === 0) {
                    itemList.innerHTML = '<div class="no-items"><div style="font-size: 48px; margin-bottom: 15px;">📭</div><h3>No Items Found</h3><p>Create your first item using the form on the left!</p></div>';
                    return;
                }

                renderItems(items);
            } catch (error) {
                console.error('Error loading items:', error);
                itemList.innerHTML = '<div class="no-items" style="color: #ff416c;"><div style="font-size: 48px; margin-bottom: 15px;">⚠️</div><h3>Error Loading Items</h3><p>' + error.message + '</p><button class="btn btn-secondary" onclick="loadItems()" style="margin-top: 15px;">Retry</button></div>';
            }
        }

        // Render items list
        function renderItems(items) {
            itemList.innerHTML = '';
            
            items.forEach(item => {
                const itemElement = document.createElement('div');
                itemElement.className = 'item-card';
                itemElement.innerHTML = '<div class="item-header"><h3 class="item-title">' + item.name + '</h3><span class="item-id">ID: ' + item.id + '</span></div><p class="item-description">' + (item.description || '<em>No description</em>') + '</p><div class="item-meta"><div class="item-date"><span>📅 ' + new Date(item.created_at).toLocaleDateString() + '</span><span>⏰ ' + new Date(item.created_at).toLocaleTimeString() + '</span></div><div class="item-actions"><button class="btn btn-warning" onclick="editItem(' + item.id + ')" title="Edit">✏️ Edit</button><button class="btn btn-danger" onclick="deleteItemWithConfirm(' + item.id + ')" title="Delete">🗑️ Delete</button></div></div>';
                itemList.appendChild(itemElement);
            });
        }

        // Handle form submission (Create)
        async function handleSubmit(e) {
            e.preventDefault();
            
            const name = nameInput.value.trim();
            const description = descInput.value.trim();
            
            if (!name) {
                await showSweetAlert('Validation Error', 'Item name is required!', 'error');
                nameInput.focus();
                return;
            }
            
            try {
                const response = await fetch(API_BASE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, description })
                });
                
                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.error || 'Failed to create item');
                }
                
                await showSweetAlert('Success!', 'Item created successfully!', 'success');
                
                // Reset form and reload items
                clearForm();
                loadItems();
                updateJsonPreview();
                
            } catch (error) {
                console.error('Error creating item:', error);
                await showSweetAlert('Error', 'Failed to create item: ' + error.message, 'error');
            }
        }

        // Handle update (for Update button)
        async function handleUpdate() {
            if (!currentEditId) return;
            
            const name = nameInput.value.trim();
            const description = descInput.value.trim();
            
            if (!name) {
                await showSweetAlert('Validation Error', 'Item name is required!', 'error');
                nameInput.focus();
                return;
            }
            
            try {
                const response = await fetch(API_BASE_URL + '/' + currentEditId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, description })
                });
                
                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.error || 'Failed to update item');
                }
                
                await showSweetAlert('Success!', 'Item updated successfully!', 'success');
                
                // Reset form and reload items
                cancelEdit();
                loadItems();
                
            } catch (error) {
                console.error('Error updating item:', error);
                await showSweetAlert('Error', 'Failed to update item: ' + error.message, 'error');
            }
        }

        // Edit item with SweetAlert form
        async function editItem(id) {
            try {
                // Show loading
                const loadingAlert = await Swal.fire({
                    title: 'Loading item...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });
                
                const response = await fetch(API_BASE_URL + '/' + id);
                const item = await response.json();
                
                Swal.close();
                
                if (item.error) {
                    await showSweetAlert('Error', item.error, 'error');
                    return;
                }
                
                // Use SweetAlert for editing
                const { value: formValues } = await Swal.fire({
                    title: 'Edit Item',
                    html: '<input id="swal-name" class="swal2-input" placeholder="Item name" value="' + item.name + '"><textarea id="swal-description" class="swal2-textarea" placeholder="Description">' + (item.description || '') + '</textarea>',
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: 'Update',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#6a11cb',
                    preConfirm: () => {
                        const name = document.getElementById('swal-name').value.trim();
                        const description = document.getElementById('swal-description').value.trim();
                        
                        if (!name) {
                            Swal.showValidationMessage('Item name is required');
                            return false;
                        }
                        
                        return { name, description };
                    }
                });
                
                if (formValues) {
                    // Update via API
                    const updateResponse = await fetch(API_BASE_URL + '/' + id, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formValues)
                    });
                    
                    const result = await updateResponse.json();
                    
                    if (!updateResponse.ok) {
                        throw new Error(result.error || 'Failed to update item');
                    }
                    
                    await showSweetAlert('Success!', 'Item updated successfully!', 'success');
                    loadItems();
                }
                
            } catch (error) {
                console.error('Error editing item:', error);
                await showSweetAlert('Error', 'Failed to edit item: ' + error.message, 'error');
            }
        }

        // Delete item with SweetAlert confirmation
        async function deleteItemWithConfirm(id) {
            try {
                // Get item details for confirmation message
                const response = await fetch(API_BASE_URL + '/' + id);
                const item = await response.json();
                
                if (item.error) {
                    await showSweetAlert('Error', 'Item not found', 'error');
                    return;
                }
                
                const result = await Swal.fire({
                    title: 'Are you sure?',
                    html: '<p>You are about to delete:</p><div style="text-align: left; background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;"><strong>' + item.name + '</strong><br><small>' + (item.description || 'No description') + '</small></div><p style="color: #ff416c; font-weight: bold;">This action cannot be undone!</p>',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#ff416c',
                    cancelButtonColor: '#95a5a6',
                    confirmButtonText: 'Yes, delete it!',
                    cancelButtonText: 'Cancel',
                    reverseButtons: true,
                    showClass: {
                        popup: 'animate__animated animate__headShake'
                    }
                });
                
                if (result.isConfirmed) {
                    // Show deleting animation
                    const deleteAlert = await Swal.fire({
                        title: 'Deleting...',
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });
                    
                    const deleteResponse = await fetch(API_BASE_URL + '/' + id, {
                        method: 'DELETE'
                    });
                    
                    Swal.close();
                    
                    if (!deleteResponse.ok) {
                        const errorResult = await deleteResponse.json();
                        throw new Error(errorResult.error || 'Failed to delete item');
                    }
                    
                    await showSweetAlert('Deleted!', 'Item has been deleted.', 'success');
                    loadItems();
                }
                
            } catch (error) {
                console.error('Error deleting item:', error);
                await showSweetAlert('Error', 'Failed to delete item: ' + error.message, 'error');
            }
        }

        // Set form to edit mode
        function setEditMode(item) {
            isEditing = true;
            currentEditId = item.id;
            
            // Fill form
            nameInput.value = item.name;
            descInput.value = item.description || '';
            itemIdInput.value = item.id;
            
            // Toggle buttons
            submitBtn.classList.add('hidden');
            updateBtn.classList.remove('hidden');
            cancelBtn.classList.remove('hidden');
            
            // Focus on name field
            nameInput.focus();
            
            // Update JSON preview
            updateJsonPreview();
            
            // Show alert
            showAlert('Editing item #' + item.id + ' - "' + item.name + '"', 'success');
        }

        // Cancel edit mode
        function cancelEdit() {
            isEditing = false;
            currentEditId = null;
            
            // Clear form
            clearForm();
            
            // Toggle buttons
            submitBtn.classList.remove('hidden');
            updateBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            
            // Update JSON preview
            updateJsonPreview();
            
            showAlert('Edit cancelled', 'success');
        }

        // Clear form
        function clearForm() {
            itemForm.reset();
            itemIdInput.value = '';
            updateJsonPreview();
        }

        // Quick action: Delete with single click confirmation
        async function quickDelete(id) {
            const result = await Swal.fire({
                title: 'Quick Delete?',
                text: 'This will delete the item immediately.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#ff416c',
                cancelButtonColor: '#95a5a6',
                confirmButtonText: 'Delete',
                cancelButtonText: 'Cancel'
            });
            
            if (result.isConfirmed) {
                await deleteItemWithConfirm(id);
            }
        }

        // Export functions to global scope
        window.loadItems = loadItems;
        window.editItem = editItem;
        window.deleteItemWithConfirm = deleteItemWithConfirm;
        window.clearForm = clearForm;
        window.quickDelete = quickDelete;
    </script>
</body>
</html>`;
}