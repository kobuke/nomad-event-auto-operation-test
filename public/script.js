document.addEventListener('DOMContentLoaded', () => {
    // --- Element & Modal Definitions ---
    const contentArea = document.getElementById('content-area');
    const tableTitle = document.getElementById('table-title');
    const navLinks = document.querySelectorAll('.nav-link');
    const createNewBtn = document.getElementById('create-new-btn');
    const sortEventsBtn = document.getElementById('sort-events-btn');
    const editForm = document.getElementById('edit-form');
    
    const editModal = new bootstrap.Modal(document.getElementById('editModal'));
    const rsvpsModal = new bootstrap.Modal(document.getElementById('rsvpsModal'));
    const paymentsModal = new bootstrap.Modal(document.getElementById('paymentsModal'));

    let currentView = 'events';
    let eventSortOrder = 'desc'; // 'desc' for newest first, 'asc' for oldest first

    // --- Data Loading & View Routing ---
    const loadView = async (viewName) => {
        currentView = viewName;
        const title = viewName.charAt(0).toUpperCase() + viewName.slice(1);
        tableTitle.textContent = title.replace(/_/g, ' ');
        createNewBtn.style.display = ['events', 'settings'].includes(viewName) ? 'block' : 'none';
        sortEventsBtn.style.display = viewName === 'events' ? 'block' : 'none';

        try {
            let data;
            if (viewName === 'events') {
                const response = await fetch(`/api/dashboard/events?sort=${eventSortOrder}`);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Failed to fetch dashboard events: ${response.status} ${response.statusText} - ${errorBody}`);
                }
                data = await response.json();
                contentArea.classList.remove('table-responsive'); // Remove class for card view
                renderDashboardCards(data);
            } else if (viewName === 'rsvps') {
                const response = await fetch(`/api/${viewName}`);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Failed to fetch ${viewName}: ${response.status} ${response.statusText} - ${errorBody}`);
                }
                data = await response.json();
                contentArea.classList.add('table-responsive');
                renderGroupedRsvps(data);
            } else if (viewName === 'payments') {
                const response = await fetch(`/api/${viewName}`);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Failed to fetch ${viewName}: ${response.status} ${response.statusText} - ${errorBody}`);
                }
                data = await response.json();
                contentArea.classList.add('table-responsive');
                renderGroupedPayments(data);
            } else {
                const response = await fetch(`/api/${viewName}`);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Failed to fetch ${viewName}: ${response.status} ${response.statusText} - ${errorBody}`);
                }
                data = await response.json();
                contentArea.classList.add('table-responsive'); // Add class for table views
                if (viewName === 'settings') renderSettings(data);
                else renderTable(data);
            }
        } catch (error) {
            contentArea.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    };

    // --- Rendering Functions ---
    const renderGroupedPayments = (payments) => {
        if (!payments.length) {
            contentArea.innerHTML = '<p class="text-center text-muted">No payments found.</p>';
            return;
        }

        // Group payments by username
        const paymentsByUser = payments.reduce((acc, payment) => {
            const userIdentifier = payment.username || payment.display_name || `User ID: ${payment.user_id}`; // Fallback if username/display_name is missing
            if (!acc[userIdentifier]) {
                acc[userIdentifier] = [];
            }
            acc[userIdentifier].push(payment);
            return acc;
        }, {});

        let html = '<div class="accordion" id="paymentsAccordion">';
        let i = 0;
        for (const userIdentifier in paymentsByUser) {
            const userPayments = paymentsByUser[userIdentifier];
            const userId = `collapsePayments${i}`;
            const headerId = `headingPayments${i}`;

            html += `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="${headerId}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${userId}" aria-expanded="false" aria-controls="${userId}">
                            ${userIdentifier} <span class="badge bg-primary ms-2">${userPayments.length} Payments</span>
                        </button>
                    </h2>
                    <div id="${userId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#paymentsAccordion">
                        <div class="accordion-body">
                            <table class="table table-striped table-hover table-sm">
                                <thead>
                                    <tr>
                                        <th>Event Title</th>
                                        <th>Amount (JPY)</th>
                                        <th>Status</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${userPayments.map(payment => `
                                        <tr>
                                            <td>${payment.event_name || 'N/A'}</td>
                                            <td>¥${payment.amount_jpy ? payment.amount_jpy.toLocaleString() : '0'}</td>
                                            <td>${payment.status}</td>
                                            <td>${payment.paid_at ? new Date(payment.paid_at).toLocaleString() : (payment.dm_sent_at ? new Date(payment.dm_sent_at).toLocaleString() + ' (DM Sent)' : 'N/A')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            i++;
        }
        html += '</div>';
        contentArea.innerHTML = html;
    };

    const renderDashboardCards = (events) => {
        if (!events.length) {
            contentArea.innerHTML = '<p class="text-center text-muted">No events found.</p>';
            return;
        }

        const cardsHtml = events.map(event => {
            const isPaidEvent = event.fee > 0;
            const currentParticipants = parseInt(event.currentParticipants) || 0;
            const maxCapacity = parseInt(event.max_capacity) || 0;
            const fillRate = maxCapacity > 0 ? Math.round((currentParticipants / maxCapacity) * 100) : 0;
            const paidCount = parseInt(event.paidCount) || 0;
            const eventColorClass = generateEventColor(event.id);

            // Determine conditional classes and attributes
            const rsvpsClasses = currentParticipants > 0 ? 'rsvps-section' : 'disabled-section';
            const rsvpsAttributes = currentParticipants > 0 ? `data-event-id="${event.id}" data-event-title="${event.title}"` : '';
            const paymentsClasses = paidCount > 0 ? 'payments-section' : 'disabled-section';
            const paymentsAttributes = paidCount > 0 ? `data-event-id="${event.id}" data-event-title="${event.title}"` : '';

            return `
                <div class="col-12 col-md-6 col-lg-4 mb-4">
                    <div class="card shadow-sm border-0 h-100 position-relative overflow-hidden card-hover-effect">
                        <div class="card-header ${eventColorClass} text-white p-3 pb-5 position-relative" style="height: 140px;">
                            <div class="d-flex justify-content-between align-items-start w-100">
                                <div class="d-flex flex-column align-items-start"> <!-- Flex column to stack items -->
                                    <!-- 日付ラベル -->
                                    <span class="badge bg-white text-dark shadow-sm py-1 px-2 d-flex align-items-center mb-1">
                                        <i class="bi bi-calendar me-1"></i> ${formatCardDate(event.start_at)}
                                    </span>
                                    
                                </div>
                            </div>
                            <h5 class="card-title text-white fw-bold text-center mt-3 mb-0" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">${event.title}</h5>
                        </div>
                        <div class="position-absolute emoji-float-top-right rounded-circle bg-white d-flex align-items-center justify-content-center shadow-sm border border-light" style="width: 48px; height: 48px; font-size: 1.5rem; z-index: 1;">
                            ${event.emoji ? event.emoji : '<small class="text-muted" style="font-size: 0.8rem;">N/A</small>'}
                        </div>
                        <div class="card-body p-4 pt-5 flex-grow-1 d-flex flex-column">
                            <div class="d-flex justify-content-between align-items-center text-muted small mb-3">
                                <div class="d-flex flex-column align-items-start">
                                    <span class="badge bg-light text-secondary font-monospace d-flex align-items-center mb-1" title="Message ID">
                                        <span class="me-1">Msg:</span> <span class="thread-id-text">${event.discord_message_id || 'N/A'}</span>
                                    </span>
                                    <span class="badge bg-light text-secondary font-monospace d-flex align-items-center mb-1" title="Thread ID">
                                        <span class="me-1">Thrd:</span> <span class="thread-id-text">${event.discord_thread_id || 'N/A'}</span>
                                    </span>
                                    ${event.remind1_at ? `<span class="badge bg-light text-secondary font-monospace d-flex align-items-center mb-1" title="Reminder 1"><span class="me-1">R1:</span> <span class="thread-id-text">${formatShortDate(event.remind1_at)}</span></span>` : ''}
                                    ${event.remind2_at ? `<span class="badge bg-light text-secondary font-monospace d-flex align-items-center" title="Reminder 2"><span class="me-1">R2:</span> <span class="thread-id-text">${formatShortDate(event.remind2_at)}</span></span>` : ''}
                                </div>
                                <div class="d-flex flex-column align-items-end">
                                    <span class="text-xs text-danger fw-medium d-flex align-items-center" title="Deadline">
                                        <i class="bi bi-exclamation-circle-fill me-1"></i> 締切: ${formatShortDate(event.deadline_at)}
                                    </span>
                                </div>
                            </div>
                            <div class="row text-center border-top border-bottom py-3 mb-3 mx-0">
                                <div class="col-4 d-flex flex-column justify-content-center border-end">
                                    <small class="text-muted text-uppercase fw-bold" style="font-size: 0.65rem;">参加費</small>
                                    <span class="fw-bold text-dark fs-6">${event.fee > 0 ? `¥${event.fee.toLocaleString()}` : "無料"}</span>
                                </div>
                                <div class="col-4 d-flex flex-column justify-content-center border-end ${rsvpsClasses}" ${rsvpsAttributes}>
                                    <small class="text-muted text-uppercase fw-bold" style="font-size: 0.65rem;">参加状況</small>
                                    <div class="d-flex align-items-end justify-content-center">
                                        <i class="bi bi-people-fill text-primary me-1"></i>
                                        <span class="fw-bold text-dark">${currentParticipants}</span>
                                        <span class="text-muted small">/${maxCapacity}</span>
                                    </div>
                                    <div class="progress mt-1 mx-2" style="height: 5px;">
                                        <div class="progress-bar bg-primary" role="progressbar" style="width: ${fillRate}%" aria-valuenow="${fillRate}" aria-valuemin="0" aria-valuemax="100"></div>
                                    </div>
                                </div>
                                <div class="col-4 d-flex flex-column justify-content-center ${paymentsClasses}" ${paymentsAttributes}>
                                    <small class="text-muted text-uppercase fw-bold" style="font-size: 0.65rem;">決済完了</small>
                                    <div class="d-flex align-items-end justify-content-center">
                                        <i class="bi bi-credit-card-fill ${isPaidEvent ? "text-success" : "text-secondary"} me-1"></i>
                                        <span class="fw-bold ${isPaidEvent ? "text-success" : "text-muted"} fs-6">${paidCount}</span>
                                    </div>
                                </div>
                            </div>
                            <button class="btn btn-outline-secondary btn-sm mt-auto edit-event-btn" data-event-id="${event.id}">詳細管理画面へ</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        contentArea.innerHTML = `<div class="row mt-4">${cardsHtml}</div>`;
    };

    const renderGroupedRsvps = (rsvps) => {
        if (!rsvps.length) {
            contentArea.innerHTML = '<p class="text-center text-muted">No RSVPs found.</p>';
            return;
        }

        // Group RSVPs by event_name
        const rsvpsByEvent = rsvps.reduce((acc, rsvp) => {
            const eventTitle = rsvp.event_name;
            if (!acc[eventTitle]) {
                acc[eventTitle] = [];
            }
            acc[eventTitle].push(rsvp);
            return acc;
        }, {});

        let html = '<div class="accordion" id="rsvpsAccordion">';
        let i = 0;
        for (const eventTitle in rsvpsByEvent) {
            const eventRsvps = rsvpsByEvent[eventTitle];
            const eventId = `collapseRsvps${i}`;
            const headerId = `headingRsvps${i}`;

            html += `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="${headerId}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${eventId}" aria-expanded="false" aria-controls="${eventId}">
                            ${eventTitle} <span class="badge bg-primary ms-2">${eventRsvps.length} RSVPs</span>
                        </button>
                    </h2>
                    <div id="${eventId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#rsvpsAccordion">
                        <div class="accordion-body">
                            <table class="table table-striped table-hover table-sm">
                                <thead>
                                    <tr>
                                        <th>Username</th>
                                        <th>Display Name</th>
                                        <th>Status</th>
                                        <th>RSVPed At</th>
                                        <th>Cancelled At</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${eventRsvps.map(rsvp => `
                                        <tr>
                                            <td>${rsvp.username}</td>
                                            <td>${rsvp.display_name || rsvp.username}</td>
                                            <td><span class="badge ${rsvp.status === 'going' ? 'bg-success' : 'bg-secondary'}">${rsvp.status}</span></td>
                                            <td>${new Date(rsvp.rsvp_at).toLocaleString()}</td>
                                            <td>${rsvp.cancelled_at ? new Date(rsvp.cancelled_at).toLocaleString() : '<span class="text-muted">N/A</span>'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            i++;
        }
        html += '</div>';
        contentArea.innerHTML = html;
    };

    const renderTable = (data) => {
        if (!data.length) { contentArea.innerHTML = '<p class="text-center text-muted">No data found.</p>'; return; }
        const headers = Object.keys(data[0]);
        contentArea.innerHTML = `<table class="table table-hover"><thead><tr>${headers.map(h => `<th>${h.replace(/_/g, ' ')}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${data.map(row => `<tr data-id="${row.id}">${headers.map(h => `<td>${formatCell(row[h])}</td>`).join('')}<td><button class="btn btn-sm btn-outline-secondary edit-btn" data-id="${row.id}">Edit</button><button class="btn btn-sm btn-outline-danger delete-btn" data-id="${row.id}">Delete</button></td></tr>`).join('')}</tbody></table>`;
    };

    const renderSettings = (data) => {
        contentArea.innerHTML = `<table class="table"><thead><tr><th>Key</th><th>Value</th><th>Description</th><th>Actions</th></tr></thead><tbody>${data.map(s => {
            let valueInputHtml;
            const descriptionText = s.description || '';

            if (s.key === 'SEND_DM_FOR_ZERO_PAYMENT_TEST') {
                const isChecked = s.value === 'true' || s.value === true; // Handle both string and boolean from DB
                valueInputHtml = `
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="radio" name="${s.key}" id="${s.key}-true" value="true" ${isChecked ? 'checked' : ''}>
                        <label class="form-check-label" for="${s.key}-true">有効 (Test Only)</label>
                    </div>
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="radio" name="${s.key}" id="${s.key}-false" value="false" ${!isChecked ? 'checked' : ''}>
                        <label class="form-check-label" for="${s.key}-false">無効</label>
                    </div>
                `;
            } else {
                valueInputHtml = `<input type="text" class="form-control" value="${s.value}">`;
            }

            return `<tr data-key="${s.key}">
                        <td><code>${s.key}</code></td>
                        <td>${valueInputHtml}</td>
                        <td><small class="text-muted">${descriptionText}</small></td>
                        <td>
                            <button class="btn btn-sm btn-success save-setting-btn">Save</button>
                            <button class="btn btn-sm btn-danger delete-setting-btn">Delete</button>
                        </td>
                    </tr>`;
        }).join('')}</tbody></table>`;
    };

    // --- Helper Functions ---
    const generateEventColor = (eventId) => {
        const gradientClasses = ['card-gradient-blue-cyan', 'card-gradient-emerald-teal', 'card-gradient-purple-indigo', 'card-gradient-orange-pink', 'card-gradient-red-yellow', 'card-gradient-green-blue'];
        const hash = String(eventId).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return gradientClasses[hash % gradientClasses.length];
    };
    const formatDateTimeString = (dateStr) => {
        if (!dateStr || dateStr.length < 16) return 'N/A';

        // "YYYY-MM-DDTHH:MM:SS..." の形式を想定
        try {
            const month = dateStr.substring(5, 7);
            const day = dateStr.substring(8, 10);
            const hour = dateStr.substring(11, 13);
            const minute = dateStr.substring(14, 16);

            // 先頭の0を削除（例: "05" -> "5"）
            const formattedMonth = parseInt(month, 10);
            const formattedDay = parseInt(day, 10);

            return `${formattedMonth}/${formattedDay} ${hour}:${minute}`;
        } catch (e) {
            // 万が一、想定外のフォーマットだった場合は、元の文字列をそのまま返す
            console.error("Date formatting failed for:", dateStr, e);
            return dateStr;
        }
    };

    const formatCardDate = (dateStr) => {
        return formatDateTimeString(dateStr);
    };

    const formatShortDate = (dateStr) => {
        return formatDateTimeString(dateStr);
    };
    const formatCell = (value) => {
        if (value === null || typeof value === 'undefined') return '<i class="text-muted">NULL</i>';
        if (typeof value === 'boolean') return value ? '✅' : '❌';
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return new Date(value).toLocaleString();
        return value.toString().length > 50 ? value.toString().substring(0, 50) + '...' : value;
    };
    const buildFormFromSchema = (fields, item = {}) => {
        const advancedFields = ['mc_required', 'remind1_sent', 'remind2_sent', 'deadline_notice_sent'];
        const labelMap = {
            'mc_required': '参加上限人数オーバー',
            'deadline_notice_sent': '募集締切のお知らせ完了',
            'remind1_sent': 'リマインド1回目完了',
            'remind2_sent': 'リマインド2回目完了'
        };

        let mainHtml = '';
        let advancedHtml = '';

        fields.forEach(field => {
            const key = field.column_name;
            if (['id', 'created_at', 'updated_at'].includes(key)) return;
            const value = item[key];
            
            const displayName = labelMap[key] || key.replace(/_/g, ' ');
            let inputHtml = '';
            const label = `<label for="${key}" class="form-label">${displayName}</label>`;
            const checkLabel = `<label class="form-check-label" for="${key}">${displayName}</label>`;

            if (field.data_type.includes('timestamp')) {
                inputHtml = `<div class="mb-3">${label}<input type="datetime-local" class="form-control" name="${key}" value="${value ? new Date(value).toISOString().slice(0, 16) : ''}"></div>`;
            } else if (field.data_type === 'boolean') {
                inputHtml = `
                    <div class="form-check mb-3">
                        <input type="hidden" name="${key}" value="false">
                        <input class="form-check-input" type="checkbox" name="${key}" value="true" id="${key}" ${value === true ? 'checked' : ''}>
                        ${checkLabel}
                    </div>
                `;
            } else if (field.data_type.includes('int')) {
                 inputHtml = `<div class="mb-3">${label}<input type="number" class="form-control" name="${key}" value="${value === 0 ? 0 : (value || '')}"></div>`;
            } else {
                 inputHtml = `<div class="mb-3">${label}<input type="text" class="form-control" name="${key}" value="${value || ''}"></div>`;
            }

            if (advancedFields.includes(key)) {
                advancedHtml += inputHtml;
            } else {
                mainHtml += inputHtml;
            }
        });

        editForm.innerHTML = mainHtml + `
            <p>
                <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="collapse" data-bs-target="#advanced-settings" aria-expanded="false" aria-controls="advanced-settings">
                    Advanced Settings
                </button>
            </p>
            <div class="collapse" id="advanced-settings">
                <div class="card card-body bg-light">
                    ${advancedHtml}
                </div>
            </div>
        `;
    };

    // --- Action Handlers ---
    const handleEdit = async (id) => {
        try {
            const [itemRes, schemaRes] = await Promise.all([fetch(`/api/${currentView}/${id}`), fetch(`/api/${currentView}/schema`)]);
            if (!itemRes.ok) throw new Error(`Failed to fetch item data: ${itemRes.status} ${itemRes.statusText}`);
            if (!schemaRes.ok) throw new Error(`Failed to fetch schema: ${schemaRes.status} ${schemaRes.statusText}`);
            const item = await itemRes.json();
            const schema = await schemaRes.json();
            editForm.dataset.id = id;
            buildFormFromSchema(schema, item);
            document.getElementById('editModalLabel').textContent = `Edit ${currentView.slice(0, -1)} #${id}`;
            editModal.show();
        } catch (error) { console.error('Edit error:', error); }
    };
    const handleShowRsvps = async (eventId, eventTitle) => {
        document.getElementById('rsvpsModalLabel').textContent = `Attendees for: ${eventTitle}`;
        const body = document.getElementById('rsvpsModalBody');
        body.innerHTML = '<div class="d-flex justify-content-center"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';
        rsvpsModal.show();
        try {
            const response = await fetch(`/api/events/${eventId}/rsvps`);
            if (!response.ok) throw new Error('Failed to fetch attendees.');
            const attendees = await response.json();
            if (attendees.length === 0) {
                body.innerHTML = '<p class="text-muted text-center">No attendees (status: "going") found for this event.</p>';
                return;
            }
            body.innerHTML = `<table class="table table-striped"><thead><tr><th>Username</th><th>Display Name</th><th>RSVPed At</th></tr></thead><tbody>${attendees.map(a => `<tr><td>${a.username}</td><td>${a.display_name || a.username}</td><td>${new Date(a.rsvp_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
        } catch (error) {
            body.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    };
    const handleShowPayments = async (eventId, eventTitle) => {
        document.getElementById('paymentsModalLabel').textContent = `Payment Status for: ${eventTitle}`;
        const body = document.getElementById('paymentsModalBody');
        body.innerHTML = '<div class="d-flex justify-content-center"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';
        paymentsModal.show();
        try {
            const response = await fetch(`/api/events/${eventId}/payments`);
            if (!response.ok) throw new Error('Failed to fetch payment statuses.');
            const payments = await response.json();
            const paid = payments.filter(p => p.status === 'paid');
            const dmSent = payments.filter(p => p.status === 'dm_sent');
            if (paid.length === 0 && dmSent.length === 0) {
                body.innerHTML = '<p class="text-muted text-center">No payment information found for this event.</p>';
                return;
            }
            let html = '';
            if (paid.length > 0) {
                html += '<h5><i class="bi bi-check-circle-fill text-success"></i> Paid</h5>' +
                    `<table class="table table-sm table-striped"><thead><tr><th>Username</th><th>Display Name</th><th>Amount</th><th>Paid At</th></tr></thead><tbody>${paid.map(p => `<tr><td>${p.username}</td><td>${p.display_name}</td><td>¥${p.amount_jpy.toLocaleString()}</td><td>${new Date(p.paid_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
            }
            if (dmSent.length > 0) {
                html += '<h5 class="mt-4"><i class="bi bi-send-fill text-info"></i> DM Sent (Not Paid Yet)</h5>' +
                    `<table class="table table-sm table-striped"><thead><tr><th>Username</th><th>Display Name</th><th>DM Sent At</th></tr></thead><tbody>${dmSent.map(p => `<tr><td>${p.username}</td><td>${p.display_name}</td><td>${new Date(p.dm_sent_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
            }
            body.innerHTML = html;
        } catch (error) {
            body.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    };
    const handleCreate = async () => {
        try {
            const schemaRes = await fetch(`/api/${currentView}/schema`);
            if (!schemaRes.ok) throw new Error('Failed to fetch schema.');
            const schema = await schemaRes.json();
            
            delete editForm.dataset.id;
            buildFormFromSchema(schema);
            document.getElementById('editModalLabel').textContent = `Create New ${currentView.slice(0, -1)}`;
            editModal.show();
        } catch(error) { console.error('Create error:', error); }
    };
    const handleDelete = async (id) => {
        if (!window.confirm(`Are you sure you want to delete item #${id}?`)) return;
        try {
            const res = await fetch(`/api/${currentView}/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete item.');
            loadView(currentView);
        } catch (error) { alert('Error deleting item: ' + error.message); }
    };
    const handleDeleteSetting = async (key) => {
        if (!window.confirm(`Are you sure you want to delete setting '${key}'? This action cannot be undone.`)) return;
        try {
            const res = await fetch(`/api/settings/${key}`, { method: 'DELETE' });
            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: 'Failed to delete setting.' }));
                throw new Error(errorBody.error);
            }
            loadView(currentView); // Reload the settings view
        } catch (error) {
            alert('Error deleting setting: ' + error.message);
        }
    };
    const handleSaveSetting = async (key, value) => {
        try {
            const res = await fetch(`/api/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save setting.');
            }
            // Optionally show a success message
            alert(`Setting '${key}' saved.`);
        } catch (error) {
            alert('Error saving setting: ' + error.message);
        }
    };

    // --- Event Listeners ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            loadView(link.getAttribute('data-table'));
        });
    });

    contentArea.addEventListener('click', (e) => {
        const editEventBtn = e.target.closest('.edit-event-btn');
        if (editEventBtn) {
            handleEdit(editEventBtn.dataset.eventId);
            return;
        }
        const rsvpsSection = e.target.closest('.rsvps-section');
        if (rsvpsSection) {
            handleShowRsvps(rsvpsSection.dataset.eventId, rsvpsSection.dataset.eventTitle);
            return;
        }
        const paymentsSection = e.target.closest('.payments-section');
        if (paymentsSection) {
            handleShowPayments(paymentsSection.dataset.eventId, paymentsSection.dataset.eventTitle);
            return;
        }
        // Legacy table-based view actions
        if (e.target.classList.contains('edit-btn')) handleEdit(e.target.dataset.id);
        if (e.target.classList.contains('delete-btn')) handleDelete(e.target.dataset.id);
        if (e.target.classList.contains('save-setting-btn')) {
            const row = e.target.closest('tr');
            const key = row.dataset.key;
            let value;
            if (key === 'SEND_DM_FOR_ZERO_PAYMENT_TEST') {
                // Find the checked radio button within this row
                const checkedRadio = row.querySelector(`input[name="${key}"]:checked`);
                value = checkedRadio ? checkedRadio.value : 'false'; // Default to false if nothing checked (shouldn't happen with radios)
            } else {
                value = row.querySelector('input').value;
            }
            handleSaveSetting(key, value);
        }
        if (e.target.classList.contains('delete-setting-btn')) handleDeleteSetting(e.target.closest('tr').dataset.key);
    });

    createNewBtn.addEventListener('click', handleCreate);

    sortEventsBtn.addEventListener('click', () => {
        eventSortOrder = eventSortOrder === 'desc' ? 'asc' : 'desc';
        sortEventsBtn.textContent = eventSortOrder === 'desc' ? 'Sort: Newest First' : 'Sort: Oldest First';
        loadView('events');
    });

    document.getElementById('save-changes-btn').addEventListener('click', async () => {
        const id = editForm.dataset.id;
        const button = document.getElementById('save-changes-btn');
        const data = Object.fromEntries(new FormData(editForm));

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/${currentView}/${id}` : `/api/${currentView}`;
        
        button.disabled = true;
        button.textContent = 'Saving...';
        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save changes.');
            }
            button.disabled = false;
            button.textContent = 'Save changes';
            editModal.hide();
            loadView(currentView);
        } catch(error) {
            console.error('Save error:', error);
            alert('Save error: ' + error.message);
            button.disabled = false;
            button.textContent = 'Save changes';
        }
    });

    // Initial Load
    loadView(currentView);
});