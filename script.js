document.addEventListener("DOMContentLoaded", () => {
    // PDF.jsのワーカー設定
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    // ====================================================================
    // Screen B: メインロジック
    // ====================================================================
    const canvas = document.getElementById("pdfCanvas-B");
    if (!canvas) return;

    // --- HTML要素の取得 ---
    const ctx = canvas.getContext('2d');
    const pdfInput = document.getElementById("pdfInput-B");
    const fileNameElem = document.getElementById("fileName-B");
    const statusElem = document.getElementById("status-B");
    const placementContainer = document.getElementById('placementContainer-B');
    const inputModeContainer = document.getElementById('inputModeContainer-B');
    const goToInputModeBtn = document.getElementById('goToInputModeBtn-B');
    const goToPlacementModeBtn = document.getElementById('goToPlacementModeBtn-B');
    const valueInputForm = document.getElementById("valueInputForm-B");
    const saveTemplateBtn = document.getElementById("saveTemplateBtn-B");
    const addQuestionBtn = document.getElementById('add-question-btn');
    const questionsList = document.getElementById('questions-list');
    const toolbarTextBtn = document.getElementById('toolbar-text-btn');
    const toolbarTextareaBtn = document.getElementById('toolbar-textarea-btn');
    const toolbarChoiceBtn = document.getElementById('toolbar-choice-btn');
    const choiceDropdown = document.getElementById('choice-dropdown');
    const generatePdfBtn = document.getElementById('generatePdfBtn'); 
    const fontSelect = document.getElementById('fontSelect'); 
    const floatingControls = document.getElementById('floating-controls');
    const floatingFontSize = document.getElementById('floating-font-size');

    const autoFillBtn = document.getElementById('toolbar-autofill-btn');
    const autoFillModal = document.getElementById('autoFillModal');
    const autoFillCloseBtn = autoFillModal ? autoFillModal.querySelector('.autofill-close') : null;
    const afSourceSelect = document.getElementById('af-source-select');
    const afRulesContainer = document.getElementById('af-rules-container');
    const afAddRuleBtn = document.getElementById('af-add-rule-btn');
    const afSaveBtn = document.getElementById('af-save-btn');
    const afTargetName = document.getElementById('af-target-name');
    
    // グループ化関連
    const dateGroupBtn = document.getElementById('toolbar-date-group-btn');
    const charSplitGroupBtn = document.getElementById('toolbar-charsplit-group-btn');
    const groupingModal = document.getElementById('groupingModal');
    const closeModalBtn = groupingModal.querySelector('.close-button');
    const groupNameInput = document.getElementById('groupNameInput');
    const groupFieldsList = document.getElementById('groupFieldsList');
    const saveGroupBtn = document.getElementById('saveGroupBtn');
    const phoneGroupBtn = document.getElementById('toolbar-phone-group-btn');
    const duplicateGroupBtn = document.getElementById('toolbar-duplicate-group-btn');
    const quickDuplicateControls = document.getElementById('quick-duplicate-controls');
    const duplicateButtons = document.querySelectorAll('.dup-btn');

    // --- 状態変数 ---
    let selectedFile = null;
    let pdfPage = { originalWidth: 0, originalHeight: 0 };
    let fieldPositions = {};
    let questions = [];
    let selectedFieldForPlacement = null;
    let pdfImage = null;
    let currentMode = 'placement';
    let resizingField = null, resizingHandle = null, isDragging = false;
    let isMoving = false, movingField = null, dragOffsetX = 0, dragOffsetY = 0;
    let mouseDownPos = { x: 0, y: 0 };
    let currentMouseX = 0, currentMouseY = 0;
    const resizeHandleSize = 6;
    let elementCounter = 1;
    let selectedFieldId = null;
    let hoveredFieldId = null;
    let selectedFieldIds = [];
    let isRendering = false;
    
    // 配置サイズ記憶
    let lastSizes = {
        text: { width: 100, height: 30, size: 21 },
        textarea: { width: 300, height: 150, size: 10.5 },
        circle: { width: 30, height: 30, size: 0 },
        check: { width: 30, height: 30, size: 0 }
    };
    
    // グループ化モード用
    let groupingModeType = null;
    //自動入力モード管理
    let isAutoFillMode = false;
    // スナップガイド
    let snapGuideLines = []; 
    const SNAP_THRESHOLD = 5; 
    const SNAP_SEARCH_RANGE = 70; 

    // ====================================================================
    // イベントリスナー
    // ====================================================================

    // --- PDFファイル処理 ---
    pdfInput.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file && file.type === "application/pdf") handlePDF(file);
    });

    document.body.addEventListener("drop", e => {
        e.preventDefault();
        document.body.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file && file.type === "application/pdf") {
            handlePDF(file);
        }
    });
    document.body.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("dragover"); });
    document.body.addEventListener("dragleave", e => { e.preventDefault(); document.body.classList.remove("dragover"); });

    // --- ツールバー ---
    toolbarTextBtn.addEventListener('click', () => startPlacingElement('text'));
    toolbarChoiceBtn.addEventListener('click', (event) => { event.stopPropagation(); choiceDropdown.classList.toggle('show'); });
    if(toolbarTextareaBtn) toolbarTextareaBtn.addEventListener('click', () => startPlacingElement('textarea'));
    
    choiceDropdown.addEventListener('click', (event) => {
        event.preventDefault();
        if (event.target.tagName === 'A') {
            const choiceType = event.target.dataset.choiceType;
            startPlacingElement(choiceType);
            choiceDropdown.classList.remove('show');
        }
    });

    if (floatingFontSize) {
        floatingFontSize.addEventListener('change', (e) => {
            if (selectedFieldId && fieldPositions[selectedFieldId]) {
                fieldPositions[selectedFieldId].size = parseFloat(e.target.value);
                drawCanvasWithBoxes(); 
            }
        });
    }

    // --- 自動入力関連 ---
    if(autoFillBtn) {
        autoFillBtn.addEventListener('click', () => {
            // 既にモード中ならキャンセル
            if (isAutoFillMode) {
                isAutoFillMode = false;
                autoFillBtn.classList.remove('active');
                canvas.style.cursor = 'default';
                statusElem.textContent = "キャンセルしました。";
            } else {
                // 他のモード（グループ化など）が動いていたらキャンセル
                if (groupingModeType) cancelGroupingMode();
                
                // モード開始
                isAutoFillMode = true;
                autoFillBtn.classList.add('active'); // CSSでボタンを凹ませる用
                canvas.style.cursor = 'help'; // カーソルを「？」や指マークにする
                statusElem.textContent = "自動入力設定を行う枠をクリックしてください。";
                
                // 紛らわしいので現在の選択を解除
                selectedFieldIds = [];
                selectedFieldId = null;
                drawCanvasWithBoxes();
            }
        });
    }
    if(autoFillCloseBtn) autoFillCloseBtn.addEventListener('click', () => { autoFillModal.style.display = 'none'; });
    if(afAddRuleBtn) afAddRuleBtn.addEventListener('click', () => { addAutoFillRuleRow('', ''); });
    if(afSaveBtn) afSaveBtn.addEventListener('click', saveAutoFillSettings);

    // --- キャンバス操作 (MouseDown) ---
    canvas.addEventListener("mousedown", (e) => {
        if(floatingControls) floatingControls.style.display = 'none';
        if(quickDuplicateControls) quickDuplicateControls.style.display = 'none';
        if (currentMode !== 'placement') return;
        const { x: mouseX, y: mouseY } = getCanvasMousePos(e);

        if (groupingModeType) {
            const clickedFieldId = findClickedFieldId(mouseX, mouseY);
            if (clickedFieldId) {
                const index = selectedFieldIds.indexOf(clickedFieldId);
                if (index > -1) { selectedFieldIds.splice(index, 1); } 
                else { selectedFieldIds.push(clickedFieldId); }
            }
        } else {
            mouseDownPos = { x: e.clientX, y: e.clientY };
            const clickedFieldId = findClickedFieldId(mouseX, mouseY);

            if (e.shiftKey) {
                if (clickedFieldId) {
                    const index = selectedFieldIds.indexOf(clickedFieldId);
                    if (index > -1) { selectedFieldIds.splice(index, 1); } 
                    else { selectedFieldIds.push(clickedFieldId); }
                }
            } else {
                if (clickedFieldId) selectedFieldIds = [clickedFieldId]; 
                else selectedFieldIds = []; 
            }
            selectedFieldId = selectedFieldIds.length === 1 ? selectedFieldIds[0] : null;

            if (selectedFieldForPlacement) return;

            if (selectedFieldId) {
                const pos = fieldPositions[selectedFieldId];
                const handles = getHandlesForField(selectedFieldId);
                for (const handleName in handles) {
                    if (Math.hypot(handles[handleName].x - mouseX, handles[handleName].y - mouseY) < resizeHandleSize) {
                        isDragging = true; resizingField = selectedFieldId; resizingHandle = handleName;
                        canvas.style.cursor = getCursorForHandle(handleName);
                        drawCanvasWithBoxes(); return;
                    }
                }
                if (findClickedFieldId(mouseX, mouseY) === selectedFieldId) {
                    isMoving = true; movingField = selectedFieldId;
                    const scaleX = pdfPage.originalWidth / canvas.width;
                    const scaleY = pdfPage.originalHeight / canvas.height;
                    dragOffsetX = (mouseX * scaleX) - pos.x;
                    dragOffsetY = (mouseY * scaleY) - pos.y;
                    canvas.style.cursor = 'move';
                    drawCanvasWithBoxes(); return;
                }
            }
        }
        drawCanvasWithBoxes();
    });

    // --- キャンバス操作 (MouseMove) ---
    canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        currentMouseX = e.clientX - rect.left;
        currentMouseY = e.clientY - rect.top;
        if (currentMode !== 'placement' || groupingModeType) {
             drawCanvasWithBoxes(); return;
        }
        if (isMoving && movingField) handleMove(e);
        else if (isDragging && resizingField) handleResize();
        else updateCursorStyle(currentMouseX, currentMouseY);
        drawCanvasWithBoxes();
    });

    // --- キャンバス操作 (MouseUp) ---
    canvas.addEventListener("mouseup", () => {
        if (isDragging && resizingField && fieldPositions[resizingField]) {
            const pos = fieldPositions[resizingField];
            if (lastSizes[pos.type]) {
                lastSizes[pos.type] = { width: pos.width, height: pos.height, size: pos.size };
            }
        }
        snapGuideLines = [];
        drawCanvasWithBoxes();
        isDragging = false; resizingField = null; resizingHandle = null;
        isMoving = false; movingField = null;
    });

    canvas.addEventListener("mouseleave", () => {
        isDragging = false; resizingField = null; resizingHandle = null;
        isMoving = false; movingField = null;
        hoveredFieldId = null;
        drawCanvasWithBoxes();
    });

    // --- キャンバス操作 (Click - 新規配置) ---
    canvas.addEventListener("click", (e) => {
        if (isAutoFillMode) {
            // マウス位置を取得
            const { x: mouseX, y: mouseY } = getCanvasMousePos(e);
            // クリックした位置にあるフィールドを探す
            const clickedFieldId = findClickedFieldId(mouseX, mouseY);
            
            if (clickedFieldId) {
                // 設定モーダルを開く
                openAutoFillModal(clickedFieldId);
                
                // モードを終了して元に戻す
                isAutoFillMode = false;
                autoFillBtn.classList.remove('active');
                canvas.style.cursor = 'default';
                statusElem.textContent = "";
            }
            return; // ここで処理を終わらせる（新規配置などをさせない）
        }
        if (groupingModeType) return;
        const mouseUpPos = { x: e.clientX, y: e.clientY };
        const distance = Math.hypot(mouseUpPos.x - mouseDownPos.x, mouseUpPos.y - mouseDownPos.y);
        if (distance > 5) return;
        if (currentMode !== 'placement') return;
        if (selectedFieldForPlacement) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            let label, width, height, size;
            const type = selectedFieldForPlacement;
            
            if (lastSizes[type]) {
                width = lastSizes[type].width; height = lastSizes[type].height; size = lastSizes[type].size;
            } else {
                width = 100; height = 30; size = 10.5;
            }
            
            if (type === 'text') label = `テキスト${elementCounter++}`;
            else if (type === 'textarea') label = `文章欄${elementCounter++}`;
            else label = `${type === 'circle' ? '丸' : 'チェック'}${elementCounter++}`; 
            
            const fieldId = `field_${Date.now()}`;
            const pdfClickX = mouseX * (pdfPage.originalWidth / canvas.width);
            const pdfClickY = mouseY * (pdfPage.originalHeight / canvas.height);
            const pdfX = pdfClickX - (width / 2);
            const pdfY = pdfClickY - (height / 2);
            fieldPositions[fieldId] = { id: fieldId, type, label, value: '', x: pdfX, y: pdfY, width, height, size };
        
            selectedFieldForPlacement = null;
            canvas.style.cursor = 'default';
            drawCanvasWithBoxes();
            updateAllUnassignedSelectors();
            updateValueInputForm();
        }
        setTimeout(() => { if(typeof updateFloatingControls === 'function') updateFloatingControls(); }, 0);
    });
    
    canvas.addEventListener('dblclick', (e) => {
        if (currentMode !== 'placement' || groupingModeType) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const fieldId = findClickedFieldId(mouseX, mouseY);
        if (fieldId) {
            const pos = fieldPositions[fieldId];
            const newLabel = prompt("新しい項目名を入力してください:", pos.label);
            if (newLabel && newLabel.trim() !== "") {
                pos.label = newLabel.trim();
                drawCanvasWithBoxes();
                updateAllUnassignedSelectors();
                updateValueInputForm();
            }
        }
    });

    closeModalBtn.addEventListener('click', () => {
        groupingModal.style.display = 'none';
        if (groupingModeType) cancelGroupingMode();
    });
    
    window.addEventListener('click', (event) => {
        if (event.target == groupingModal) groupingModal.style.display = 'none';
        if (!event.target.closest('.dropdown')) {
            if (choiceDropdown.classList.contains('show')) choiceDropdown.classList.remove('show');
        }
    });

    window.addEventListener('keydown', (e) => {
        if (groupingModeType) {
            if (e.key === 'Enter') { e.preventDefault(); finishGrouping(); }
            else if (e.key === 'Escape') cancelGroupingMode();
            return;
        }
        if (currentMode === 'placement' && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            if (selectedFieldIds.length > 0) {
                if (confirm(`選択中の ${selectedFieldIds.length} 個の項目を削除しますか？`)) {
                    selectedFieldIds.forEach(id => { delete fieldPositions[id]; });
                    selectedFieldId = null;
                    selectedFieldIds = [];
                    drawCanvasWithBoxes();
                    updateAllUnassignedSelectors();
                    updateValueInputForm();
                }
            }
        }
    });

    // --- モード切替 ---
    goToInputModeBtn.addEventListener('click', () => {
        currentMode = 'input';
        placementContainer.style.display = 'none';
        inputModeContainer.style.display = 'block';
        setTodayDateToFields();
        updateValueInputForm();
        drawCanvasWithBoxes();
    });
    goToPlacementModeBtn.addEventListener('click', () => {
        currentMode = 'placement';
        placementContainer.style.display = 'block';
        inputModeContainer.style.display = 'none';
        drawCanvasWithBoxes();
    });

    // --- テンプレート保存 (JSON) ---
    saveTemplateBtn.addEventListener("click", () => {
        const templateName = prompt("テンプレート名を入力してください:", selectedFile ? selectedFile.name.replace('.pdf', '') : "");
        if (!templateName) { alert("テンプレート名を入力してください。"); return; }
    
        const positionsToSave = JSON.parse(JSON.stringify(fieldPositions));
        for (const id in positionsToSave) {
            const pos = positionsToSave[id];
            pos.x = Math.round(pos.x * 10) / 10;
            pos.y = Math.round(pos.y * 10) / 10;
            pos.width = Math.round(pos.width * 10) / 10;
            pos.height = Math.round(pos.height * 10) / 10;
            pos.size = Math.round(pos.size * 10) / 10;
        }
    
        const templateData = { name: templateName, questions, fieldPositions: positionsToSave };
        const jsonStr = JSON.stringify(templateData, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
    
        const a = document.createElement("a");
        a.href = url;
        a.download = `${templateName}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // --- テンプレート読込 ---
    const loadTemplateBtn = document.getElementById("loadTemplateBtn");
    const loadTemplateInput = document.getElementById("loadTemplateInput");
    if (loadTemplateBtn && loadTemplateInput) {
        loadTemplateBtn.addEventListener("click", () => {
            if (!pdfImage) { alert("先に背景となるPDFファイルを読み込んでください。"); return; }
            loadTemplateInput.click();
        });
        loadTemplateInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.fieldPositions) fieldPositions = data.fieldPositions;
                    if (data.questions) questions = data.questions;
                    questionsList.innerHTML = '';
                    if (questions.length > 0) questions.forEach(q => renderQuestionBlock(q));
                    
                    let maxNum = 0;
                    Object.values(fieldPositions).forEach(pos => {
                        const match = pos.label.match(/\d+$/);
                        if (match) { const num = parseInt(match[0], 10); if (num > maxNum) maxNum = num; }
                    });
                    elementCounter = maxNum + 1;
                    drawCanvasWithBoxes();
                    updateValueInputForm();
                    updateAllUnassignedSelectors();
                    alert("テンプレートを読み込みました！");
                } catch (err) { console.error(err); alert("JSONファイルの読み込みに失敗しました。"); }
                e.target.value = '';
            };
            reader.readAsText(file);
        });
    }

    // ★★★ 【修正完了】PDF生成処理 (クライアントサイド完結版) ★★★
    generatePdfBtn.addEventListener('click', async () => {
        if (!selectedFile) { alert("PDFが読み込まれていません"); return; }
        
        try {
            const { PDFDocument, rgb } = PDFLib;
            
            // 1. 元のPDFを読み込む
            const existingPdfBytes = await selectedFile.arrayBuffer();
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            
            // 2. フォントキットの登録とフォント読み込み
            pdfDoc.registerFontkit(window.fontkit);
            
            const fontName = fontSelect.value || "BIZUDGothic-Regular.ttf";
            let fontBytes;
            try {
                // ブラウザからフォントファイルをfetchする
                fontBytes = await fetch(fontName).then(res => {
                    if (!res.ok) throw new Error("Font fetch failed");
                    return res.arrayBuffer();
                });
            } catch (fontErr) {
                alert(`フォントファイル(${fontName})の読み込みに失敗しました。\nindex.htmlと同じ場所にファイルを置いてください。`);
                return;
            }
            
            const customFont = await pdfDoc.embedFont(fontBytes);

            // 3. ページへの描画処理
            const pages = pdfDoc.getPages();
            const firstPage = pages[0];
            const { height: pageHeight } = firstPage.getSize();

            for (const fieldId in fieldPositions) {
                const props = fieldPositions[fieldId];
                const { type, value, x, y, width, height, size } = props;

                if (!value && value !== 0) continue; // 値がなければスキップ

                if (type === 'textarea') {
                    const fontSize = size || 10.5;
                    const lineHeight = fontSize * 1.4;
                    // PDF-Lib用のテキスト折り返し計算
                    const lines = wrapTextPdf(String(value), width - 10, customFont, fontSize);
                    
                    // PDF座標系への変換 (左下が0,0)
                    // Canvasのyは上から。PDFは下から。
                    // 開始位置 = ページ高さ - CanvasのY座標 - フォントサイズ(上マージン代わり)
                    let currentY = pageHeight - y - fontSize; 

                    for (const line of lines) {
                        // 枠の下端チェック
                        if (currentY < (pageHeight - y - height)) break; 

                        firstPage.drawText(line, {
                            x: x + 5, // 左マージン
                            y: currentY,
                            size: fontSize,
                            font: customFont,
                            color: rgb(0, 0, 0),
                        });
                        currentY -= lineHeight;
                    }
                } else if (type === 'text') {
                    let fontSize = size || 12;
                    const text = String(value);
                    const textWidth = customFont.widthOfTextAtSize(text, fontSize);
                    
                    // 極細枠の縮小ロジック
                    const charWidth = customFont.widthOfTextAtSize("あ", fontSize);
                    if (width < charWidth) {
                        const scale = width / charWidth;
                        fontSize *= scale;
                    }

                    // 縦位置の計算 (上下中央)
                    // CanvasのY(上端) + 高さ - (高さ - 文字高)/2 ... をPDF座標(下から)に変換
                    // = pageHeight - (y + height) + (height - fontSize)/2
                    const correctedY = (pageHeight - y - height) + (height - fontSize) / 2;
                    
                    // 横位置 (中央揃え or 左揃え)
                    let drawX = x + (width - textWidth) / 2;
                    if (width < charWidth || textWidth > width) {
                        drawX = x; // 左揃え
                    }

                    firstPage.drawText(text, {
                        x: drawX,
                        y: correctedY,
                        size: fontSize,
                        font: customFont,
                        color: rgb(0, 0, 0),
                    });
                } else if (type === 'circle') {
                    // 楕円を描画
                    firstPage.drawEllipse({
                        x: x + width / 2,
                        y: pageHeight - y - height / 2,
                        xScale: width / 2,
                        yScale: height / 2,
                        borderColor: rgb(0, 0, 0),
                        borderWidth: 2,
                    });
                } else if (type === 'check') {
                    const symbol = "✓";
                    const checkFontSize = height * 0.8; 
                    const textWidth = customFont.widthOfTextAtSize(symbol, checkFontSize);
                    const centeredX = x + (width - textWidth) / 2;
                    const centeredY = (pageHeight - y - height) + (height - checkFontSize) / 2;

                    firstPage.drawText(symbol, {
                        x: centeredX,
                        y: centeredY,
                        size: checkFontSize,
                        font: customFont,
                        color: rgb(0, 0, 0),
                    });
                }
            }

            // 4. PDFの生成とプレビュー
            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: "application/pdf" });
            const blobUrl = URL.createObjectURL(blob);
            document.getElementById('finalPdfPreview-B').src = blobUrl;

        } catch (err) {
            console.error("PDF生成エラー:", err);
            alert("PDF生成中にエラーが発生しました。\nコンソールを確認してください。");
        }
    });

    // --- 質問ブロック関連 ---
    addQuestionBtn.addEventListener('click', () => {
        const questionId = `q_${Date.now()}`;
        const newQuestion = { id: questionId, title: '', type: 'radio', choices: [] };
        questions.push(newQuestion);
        renderQuestionBlock(newQuestion);
    });

    dateGroupBtn.addEventListener('click', () => {
        if (groupingModeType === 'datetime') cancelGroupingMode();
        else startGroupingMode('datetime');
    });
    
    charSplitGroupBtn.addEventListener('click', () => {
        if (groupingModeType === 'char-split') cancelGroupingMode();
        else startGroupingMode('char-split');
    });

    phoneGroupBtn.addEventListener('click', () => {
        if (groupingModeType === 'phone-split') cancelGroupingMode();
        else startGroupingMode('phone-split');
    });

    duplicateGroupBtn.addEventListener('click', () => {
        if (groupingModeType === 'duplicate') cancelGroupingMode();
        else startGroupingMode('duplicate');
    });

    duplicateButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            duplicateField(e.target.dataset.dir);
        });
    });

    saveGroupBtn.addEventListener('click', () => {
        const groupName = groupNameInput.value.trim();
        if (!groupName) { alert('グループ名を入力してください。'); return; }

        const sortedFieldIds = [...selectedFieldIds].sort((a, b) => {
            const posA = fieldPositions[a];
            const posB = fieldPositions[b];
            if (Math.abs(posA.y - posB.y) > 10) return posA.y - posB.y;
            return posA.x - posB.x;
        });
    
        if (groupingModeType === 'char-split') {
            selectedFieldIds.forEach((fieldId, index) => {
                const field = fieldPositions[fieldId];
                field.dataSource = groupName;
                field.dataPart = `char_${index}`;
                field.dataSourceType = 'char-split';
                field.label = `${groupName}[${index}]`;
            });
        } else if (groupingModeType === 'phone-split') {
            sortedFieldIds.forEach((fieldId, index) => {
                const field = fieldPositions[fieldId];
                field.dataSource = groupName;
                field.dataPart = `split_${index}`;
                field.dataSourceType = 'phone-split';
                field.label = `${groupName}[${index+1}]`;
            });
        }else if (groupingModeType === 'duplicate') {
            selectedFieldIds.forEach((fieldId, index) => {
                const field = fieldPositions[fieldId];
                field.dataSource = groupName;
                field.dataSourceType = 'duplicate';
                field.label = `${groupName}[${index+1}]`;
            });
        }else if (groupingModeType === 'datetime') {
            const fieldSelections = [];
            groupFieldsList.querySelectorAll('select').forEach(select => {
                const fieldId = select.dataset.fieldId;
                const role = select.value;
                if (fieldPositions[fieldId] && role) {
                    fieldSelections.push({ id: fieldId, role: role, x: fieldPositions[fieldId].x });
                }
            });
            const roles = [...new Set(fieldSelections.map(item => item.role))];
            roles.forEach(roleName => {
                if (roleName.endsWith('-split')) {
                    const targets = fieldSelections.filter(item => item.role === roleName).sort((a, b) => a.x - b.x);
                    targets.forEach((item, index) => {
                        const field = fieldPositions[item.id];
                        field.dataSource = groupName;
                        field.dataPart = `${roleName}_${index}`;
                        field.dataSourceType = 'datetime';
                        field.label = `${groupName}(${roleName}[${index}])`;
                    });
                } else {
                    const targets = fieldSelections.filter(item => item.role === roleName);
                    targets.forEach(item => {
                        const field = fieldPositions[item.id];
                        field.dataSource = groupName;
                        field.dataPart = roleName;
                        field.dataSourceType = 'datetime';
                    });
                }
            });
        }
        alert(`グループ「${groupName}」を保存しました。`);
        groupingModal.style.display = 'none';
        cancelGroupingMode(); 
    });

    // ====================================================================
    // 関数定義
    // ====================================================================

    function handlePDF(fileOrBlob, fileName) {
        if (isRendering) return;
        isRendering = true;
        selectedFile = fileOrBlob;
        fileNameElem.textContent = `選択されたファイル: ${fileName || fileOrBlob.name}`;
        statusElem.textContent = "PDFを読み込んでいます...";
        
        fieldPositions = {}; questions = []; elementCounter = 1;
        questionsList.innerHTML = ''; updateValueInputForm();

        const reader = new FileReader();
        reader.onload = function () {
            const typedArray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedArray).promise.then(pdf => {
                pdf.getPage(1).then(page => {
                    const scale = 1.1;
                    const viewport = page.getViewport({ scale: scale });
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    pdfPage = { originalWidth: viewport.width / scale, originalHeight: viewport.height / scale };
                    const renderContext = { canvasContext: ctx, viewport: viewport };
                    page.render(renderContext).promise.then(() => {
                        pdfImage = new Image();
                        pdfImage.src = canvas.toDataURL("image/png");
                        pdfImage.onload = () => {
                            drawCanvasWithBoxes();
                            statusElem.textContent = "PDFの読み込みが完了しました。";
                            isRendering = false;
                        };
                    });
                });
            });
        };
        reader.readAsArrayBuffer(fileOrBlob);
    }
    
    function drawCanvasWithBoxes() {
        if (!pdfImage) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(pdfImage, 0, 0, canvas.width, canvas.height);
        for (const fieldId in fieldPositions) {
            const pos = fieldPositions[fieldId];
            const { x, y, width, height } = getCanvasCoords(pos);
            drawFixedBox(x, y, fieldId, width, height, pos);
        }

        if (snapGuideLines.length > 0) {
            const scaleX = canvas.width / pdfPage.originalWidth;
            const scaleY = canvas.height / pdfPage.originalHeight;
            ctx.beginPath(); ctx.strokeStyle = "red"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            snapGuideLines.forEach(line => {
                if (line.type === 'vertical') {
                    ctx.moveTo(line.start * scaleX, line.end1 * scaleY - 20); 
                    ctx.lineTo(line.start * scaleX, line.end2 * scaleY + 20);
                } else {
                    ctx.moveTo(line.start * scaleX - 20, line.end1 * scaleY); 
                    ctx.lineTo(line.end2 * scaleX + 20, line.end1 * scaleY);
                }
            });
            ctx.stroke(); ctx.setLineDash([]);
        }

        if (selectedFieldForPlacement && currentMode === 'placement') {
            drawFloatingBox(currentMouseX, currentMouseY, selectedFieldForPlacement);
        }
    }

    function drawFixedBox(x, y, fieldId, width, height, pos) {
        const isSelected = selectedFieldIds.includes(fieldId) || selectedFieldId === fieldId;
        const isHovered = (fieldId === hoveredFieldId);
        const strokeColor = isSelected ? "blue" : "green";

        if (currentMode === 'input') {
            if (pos.value) {
                if (pos.type === 'textarea') {
                    const fontSize = (pos.size || 10.5) * (canvas.width / pdfPage.originalWidth);
                    ctx.fillStyle = 'black'; ctx.font = `${fontSize}px sans-serif`;
                    ctx.textBaseline = "top"; ctx.textAlign = "left"; 
                    
                    const text = pos.value.toString();
                    const maxWidth = width - 10 * (canvas.width / pdfPage.originalWidth); 
                    const paragraphs = text.split('\n');
                    let lineY = y + 5;

                    for (const paragraph of paragraphs) {
                        const lines = getWrappedLines(ctx, paragraph, maxWidth);
                        for (const line of lines) {
                            if (lineY + fontSize > y + height) break; 
                            ctx.fillText(line, x + 5, lineY);
                            lineY += fontSize * 1.2; 
                        }
                    }
                } else if (pos.type === 'text') {
                    let fontSize = (pos.size || 10.5) * (canvas.width / pdfPage.originalWidth);
                    ctx.font = `${fontSize}px sans-serif`;
                    const text = pos.value.toString();
                    const totalTextWidth = ctx.measureText(text).width;
                    const singleCharWidth = ctx.measureText("あ").width;
                    let isExtremelyNarrow = false;
                    if (width < singleCharWidth) {
                        isExtremelyNarrow = true;
                        fontSize *= width / singleCharWidth;
                        ctx.font = `${fontSize}px sans-serif`;
                    }
                    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
                    ctx.fillStyle = 'black'; ctx.textBaseline = "middle";
                    if (isExtremelyNarrow || totalTextWidth > width) {
                        ctx.textAlign = "left"; ctx.fillText(text, x, y + height / 2);
                    } else {
                        ctx.textAlign = "center"; ctx.fillText(text, x + width / 2, y + height / 2);
                    }
                    ctx.restore();
                } else if (pos.type === 'check') {
                    const symbol = "✓"; 
                    const fontSize = height * 0.9 * (canvas.width / pdfPage.originalWidth);
                    ctx.fillStyle = 'black'; ctx.font = `${fontSize}px sans-serif`;
                    ctx.textBaseline = "middle"; ctx.textAlign = "center"; 
                    ctx.fillText(symbol, x + width / 2, y + height / 2 + fontSize * 0.05);
                } else {
                    drawMarker(ctx, x, y, width, height, pos.type);
                }
            }
            return;
        }

        const textToDisplay = pos.label;
        if (pos.type === 'circle' || pos.type === 'check') {
            if (isSelected || isHovered) {
                ctx.fillStyle = isSelected ? "rgba(0, 0, 255, 0.1)" : "rgba(0, 128, 0, 0.1)";
                ctx.fillRect(x, y, width, height);
            }
            drawMarker(ctx, x, y, width, height, pos.type, strokeColor);
        } else {
            ctx.fillStyle = isSelected ? "rgba(0, 0, 255, 0.3)" : "rgba(0, 128, 0, 0.3)";
            ctx.fillRect(x, y, width, height);
            let fontSize = (pos.size || 10.5) * (canvas.width / pdfPage.originalWidth);
            ctx.fillStyle = 'black'; ctx.font = `${fontSize}px sans-serif`;

            if (pos.type === 'textarea') {
                ctx.textBaseline = "top"; ctx.textAlign = "left";
                const previewText = pos.value || "文章欄サンプル";
                const maxWidth = width - 10;
                const lines = getWrappedLines(ctx, previewText, maxWidth);
                let lineY = y + 5;
                for (const line of lines) {
                    if (lineY + fontSize > y + height) break;
                    ctx.fillText(line, x + 5, lineY);
                    lineY += fontSize * 1.2;
                }
            } else if (pos.type === 'text') {
                const previewText = pos.value || "あいうえお";
                const totalTextWidth = ctx.measureText(previewText).width;
                const singleCharWidth = ctx.measureText("あ").width;
                if (width < singleCharWidth) {
                    fontSize *= width / singleCharWidth;
                    ctx.font = `${fontSize}px sans-serif`;
                }
                ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
                ctx.textBaseline = "middle";
                if (width < singleCharWidth || totalTextWidth > width) {
                    ctx.textAlign = "left"; ctx.fillText(previewText, x, y + height / 2);
                } else {
                    ctx.textAlign = "center"; ctx.fillText(previewText, x + width / 2, y + height / 2);
                }
                ctx.restore();
            }
            ctx.strokeStyle = strokeColor; ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
        }

        const labelFontSize = 12 * (canvas.width / pdfPage.originalWidth);
        ctx.fillStyle = strokeColor; ctx.font = `${labelFontSize}px sans-serif`;
        ctx.textBaseline = "middle"; ctx.textAlign = "left"; 
        ctx.fillText(textToDisplay, x, y - 5);

        if ((isSelected && selectedFieldId === fieldId) || isHovered) {
            ctx.fillStyle = isSelected ? "blue" : "green";
            const handleDrawSize = resizeHandleSize / 1.5;
            const handles = getHandlesForField(fieldId);
            for(const handleName in handles) {
                const handle = handles[handleName];
                ctx.fillRect(handle.x - handleDrawSize / 2, handle.y - handleDrawSize / 2, handleDrawSize, handleDrawSize);
            }
        }
    }

    function drawFloatingBox(x, y, elementType) {
        if (!pdfPage.originalWidth) return;
        const scaleX = canvas.width / pdfPage.originalWidth;
        let boxWidth = 100, boxHeight = 30;
        if (elementType === 'textarea') { boxWidth = 300; boxHeight = 150; } 
        else if(elementType !== 'text') { boxWidth = 30; boxHeight = 30; }
        
        const canvasWidth = boxWidth * scaleX;
        const canvasHeight = boxHeight * scaleX;
        const drawX = x - canvasWidth / 2;
        const drawY = y - canvasHeight / 2;
        
        ctx.strokeStyle = "blue"; ctx.lineWidth = 2;
        if(elementType === 'circle') {
            ctx.beginPath(); ctx.ellipse(x, y, canvasWidth / 2, canvasHeight / 2, 0, 0, 2 * Math.PI); ctx.stroke(); 
        } else if(elementType === 'check') { 
            const fontSize = canvasHeight * 0.9;
            ctx.font = `${fontSize}px sans-serif`; ctx.fillStyle = "blue"; 
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("✓", x, y + fontSize * 0.1);
        } else { 
            ctx.strokeRect(drawX, drawY, canvasWidth, canvasHeight); 
            if (elementType === 'textarea') {
                ctx.fillStyle = "rgba(0, 0, 255, 0.1)"; ctx.fillRect(drawX, drawY, canvasWidth, canvasHeight);
                ctx.fillStyle = "blue"; ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("文章欄", x, y);
            }
        }
    }

    function drawMarker(ctx, x, y, width, height, type, color = 'red') {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        if (type === 'circle') {
            ctx.beginPath(); ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, 2 * Math.PI); ctx.stroke(); 
        } else if (type === 'check') { 
            const fontSize = height * 0.9 * (canvas.width / pdfPage.originalWidth);
            ctx.fillStyle = color; ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("✓", centerX, centerY + fontSize * 0.1);
            ctx.strokeRect(x, y, width, height);
        }
    }

    function startPlacingElement(type) { selectedFieldForPlacement = type; canvas.style.cursor = 'crosshair'; }
    
    function findClickedFieldId(mouseX, mouseY) {
        const fieldIds = Object.keys(fieldPositions).reverse();
        for (const fieldId of fieldIds) {
            const pos = fieldPositions[fieldId];
            const { x, y, width, height } = getCanvasCoords(pos);
            if (mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height) return fieldId;
        }
        return null;
    }
    
    function getCanvasCoords(pos) {
        if (!pdfPage.originalWidth) return { x:0, y:0, width:0, height:0 };
        const scaleX = canvas.width / pdfPage.originalWidth;
        const scaleY = canvas.height / pdfPage.originalHeight;
        return { x: pos.x * scaleX, y: pos.y * scaleY, width: pos.width * scaleX, height: pos.height * scaleY };
    }
    
    function getHandlesForField(fieldId) {
        const pos = fieldPositions[fieldId];
        const { x, y, width, height } = getCanvasCoords(pos);
        return { tl: { x: x, y: y }, t: { x: x + width / 2, y: y }, tr: { x: x + width, y: y }, l: { x: x, y: y + height / 2 }, r: { x: x + width, y: y + height / 2 }, bl: { x: x, y: y + height }, b: { x: x + width / 2, y: y + height }, br: { x: x + width, y: y + height } };
    }
    
    function handleMove(e) {
        if (!movingField) return;
        const pos = fieldPositions[movingField];
        const scaleX = pdfPage.originalWidth / canvas.width;
        const scaleY = pdfPage.originalHeight / canvas.height;
        let newX = (currentMouseX * scaleX) - dragOffsetX;
        let newY = (currentMouseY * scaleY) - dragOffsetY;

        snapGuideLines = []; 
        if (!e.altKey) {
            const myCenterX = newX + pos.width / 2, myCenterY = newY + pos.height / 2;
            let snappedX = false, snappedY = false;
    
            for (const id in fieldPositions) {
                if (id === movingField) continue;
                const t = fieldPositions[id];
                const tCenterX = t.x + t.width / 2, tCenterY = t.y + t.height / 2;
                
                if (!snappedX && Math.abs(myCenterY - tCenterY) < SNAP_SEARCH_RANGE) {
                    if (Math.abs(newX - t.x) < SNAP_THRESHOLD) { newX = t.x; snappedX = true; addSnapLine(t.x, Math.min(newY, t.y), Math.max(newY + pos.height, t.y + t.height), 'vertical'); }
                    else if (Math.abs(newX - (t.x + t.width)) < SNAP_THRESHOLD) { newX = t.x + t.width; snappedX = true; addSnapLine(t.x + t.width, Math.min(newY, t.y), Math.max(newY + pos.height, t.y + t.height), 'vertical'); }
                    else if (Math.abs(myCenterX - tCenterX) < SNAP_THRESHOLD) { newX = tCenterX - pos.width / 2; snappedX = true; addSnapLine(tCenterX, Math.min(newY, t.y), Math.max(newY + pos.height, t.y + t.height), 'vertical'); }
                }
                if (!snappedY && Math.abs(myCenterX - tCenterX) < SNAP_SEARCH_RANGE) {
                    if (Math.abs(newY - t.y) < SNAP_THRESHOLD) { newY = t.y; snappedY = true; addSnapLine(Math.min(newX, t.x), t.y, Math.max(newX + pos.width, t.x + t.width), 'horizontal'); }
                    else if (Math.abs(newY - (t.y + t.height)) < SNAP_THRESHOLD) { newY = t.y + t.height; snappedY = true; addSnapLine(Math.min(newX, t.x), t.y + t.height, Math.max(newX + pos.width, t.x + t.width), 'horizontal'); }
                    else if (Math.abs(myCenterY - tCenterY) < SNAP_THRESHOLD) { newY = tCenterY - pos.height / 2; snappedY = true; addSnapLine(Math.min(newX, t.x), tCenterY, Math.max(newX + pos.width, t.x + t.width), 'horizontal'); }
                }
            }
        }
        pos.x = newX; pos.y = newY;
    }

    function addSnapLine(start, end1, end2, type) { snapGuideLines.push({ start, end1, end2, type }); }
    
    function handleResize() { 
        const pos = fieldPositions[resizingField]; 
        const scaleX = pdfPage.originalWidth / canvas.width; 
        const scaleY = pdfPage.originalHeight / canvas.height; 
        const pdfMouseX = currentMouseX * scaleX; 
        const pdfMouseY = currentMouseY * scaleY; 
        const oldRight = pos.x + pos.width; 
        const oldBottom = pos.y + pos.height; 
        const minSize = 10; 

        if (resizingHandle.includes('r')) pos.width = Math.max(minSize, pdfMouseX - pos.x); 
        if (resizingHandle.includes('l')) { const newWidth = oldRight - pdfMouseX; if (newWidth >= minSize) { pos.width = newWidth; pos.x = pdfMouseX; } } 
        if (resizingHandle.includes('b')) pos.height = Math.max(minSize, pdfMouseY - pos.y); 
        if (resizingHandle.includes('t')) { const newHeight = oldBottom - pdfMouseY; if (newHeight >= minSize) { pos.height = newHeight; pos.y = pdfMouseY; } } 
        if (pos.type === 'text') pos.size = pos.height * 0.7; 
    }
    
    function updateCursorStyle(mouseX, mouseY) {
        let cursor = 'default'; hoveredFieldId = null;
        const fieldId = selectedFieldId || findClickedFieldId(mouseX, mouseY);
        if (fieldId) {
             const handles = getHandlesForField(fieldId);
             for (const handleName in handles) {
                 if (Math.hypot(handles[handleName].x - mouseX, handles[handleName].y - mouseY) < resizeHandleSize) {
                     cursor = getCursorForHandle(handleName); hoveredFieldId = fieldId; break;
                 }
             }
             if (cursor === 'default') {
                 const pos = fieldPositions[fieldId];
                 const { x, y, width, height } = getCanvasCoords(pos);
                 let isHovering = (pos.type === 'circle') ? (Math.hypot((x + width / 2) - mouseX, (y + height / 2) - mouseY) < Math.max(width, height) / 2) : (mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height);
                 if (isHovering) { cursor = 'move'; hoveredFieldId = fieldId; }
             }
        }
        canvas.style.cursor = cursor;
    }
    function getCursorForHandle(handleName) { switch (handleName) { case 't': case 'b': return 'ns-resize'; case 'l': case 'r': return 'ew-resize'; case 'tl': case 'br': return 'nwse-resize'; case 'tr': case 'bl': return 'nesw-resize'; default: return 'default'; } }

    function startGroupingMode(type) {
        if (groupingModeType) cancelGroupingMode();
        groupingModeType = type; selectedFieldIds = []; selectedFieldId = null;
        canvas.style.cursor = 'pointer';
        statusElem.textContent = "グループ化するフィールドを選択し、Enterキーで確定してください。(Escキーでキャンセル)";
        if (type === 'datetime') dateGroupBtn.classList.add('active');
        else if (type === 'char-split') charSplitGroupBtn.classList.add('active');
        else if (type === 'phone-split') phoneGroupBtn.classList.add('active');
        else if (type === 'duplicate') duplicateGroupBtn.classList.add('active');
    }
    
    function finishGrouping() {
        if (selectedFieldIds.length < 2) { alert('グループ化するには、フィールドを2つ以上選択してください。'); return; }
        openGroupingModal();
    }
    
    function cancelGroupingMode() {
        groupingModeType = null;
        isAutoFillMode = false; 
        if(autoFillBtn) autoFillBtn.classList.remove('active');
        dateGroupBtn.classList.remove('active'); charSplitGroupBtn.classList.remove('active');
        phoneGroupBtn.classList.remove('active'); duplicateGroupBtn.classList.remove('active');
        selectedFieldIds = []; canvas.style.cursor = 'default';
        statusElem.textContent = "キャンセルしました。"; drawCanvasWithBoxes();
    }
    
    function openGroupingModal() {
        groupFieldsList.innerHTML = ''; groupNameInput.value = '';
        if (groupingModeType === 'datetime') {
            selectedFieldIds.forEach(id => {
                const field = fieldPositions[id];
                const listItem = document.createElement('div');
                listItem.innerHTML = `
                <label style="margin-right: 10px;">${field.label}</label>
                <select data-field-id="${id}">
                    <option value="">役割を選択...</option>
                    <optgroup label="通常入力 (1つの枠)">
                        <option value="year-ad">年（西暦）</option><option value="year-wareki">年（和暦）</option><option value="month">月</option><option value="day">日</option>
                    </optgroup>
                    <optgroup label="マス目入力 (左から順に埋まる)">
                        <option value="year-ad-split">年（西暦）[1文字ずつ]</option><option value="year-wareki-split">年（和暦）[1文字ずつ]</option><option value="month-split">月 [1文字ずつ]</option><option value="day-split">日 [1文字ずつ]</option>
                    </optgroup>
                    <optgroup label="年号の丸囲み (自動判定)">
                        <option value="circle-taisyou">大正に丸</option><option value="circle-showa">昭和に丸</option><option value="circle-heisei">平成に丸</option><option value="circle-reiwa">令和に丸</option>
                    </optgroup>
                    <optgroup label="自動入力">
                        <option value="today-year-ad">【自動】今日の年（西暦）</option><option value="today-year-wareki">【自動】今日の年（和暦）</option><option value="today-month">【自動】今日の月</option><option value="today-day">【自動】今日の日</option>
                    </optgroup>
                </select>`;
                groupFieldsList.appendChild(listItem);
            });
            groupFieldsList.querySelectorAll('select').forEach(select => {
                select.addEventListener('change', (e) => {
                    const fieldId = e.target.dataset.fieldId;
                    if (fieldId && e.target.value) { fieldPositions[fieldId].label = e.target.options[e.target.selectedIndex].text; drawCanvasWithBoxes(); }
                });
            });
        } else if (groupingModeType === 'char-split') {
            groupFieldsList.innerHTML = `<p>選択された ${selectedFieldIds.length} 個のフィールドが、左から右の順に自動で割り当てられます。</p>`;
        }
        groupingModal.style.display = 'block';
    }

    function openAutoFillModal(targetId) {
        const targetField = fieldPositions[targetId]; if (!targetField) return;
        afTargetName.textContent = targetField.label;
        afSourceSelect.innerHTML = '<option value="">-- 判断元の項目を選択 --</option>';
        afRulesContainer.innerHTML = ''; 
        Object.values(fieldPositions).forEach(f => {
            if (f.id !== targetId && f.type !== 'label') {
                const option = document.createElement('option'); option.value = f.id; option.textContent = f.label; afSourceSelect.appendChild(option);
            }
        });
        if (targetField.autoFill) {
            afSourceSelect.value = targetField.autoFill.sourceId || '';
            if (targetField.autoFill.rules) targetField.autoFill.rules.forEach(rule => addAutoFillRuleRow(rule.key, rule.value));
        } else { addAutoFillRuleRow('', ''); }
        autoFillModal.style.display = 'block';
    }

    function addAutoFillRuleRow(keyVal, valueVal) {
        const row = document.createElement('div'); row.className = 'rule-row';
        row.innerHTML = `<input type="text" class="af-key" placeholder="もし(例:1)" value="${keyVal || ''}"><span>→</span><input type="text" class="af-val" placeholder="これ(例:工学部)" value="${valueVal || ''}"><span class="rule-delete">×</span>`;
        row.querySelector('.rule-delete').addEventListener('click', () => row.remove());
        afRulesContainer.appendChild(row);
    }

    function saveAutoFillSettings() {
        if (!selectedFieldIds || selectedFieldIds.length !== 1) return;
        const targetId = selectedFieldIds[0]; const sourceId = afSourceSelect.value;
        if (!sourceId) { alert("判断元となる項目を選択してください。"); return; }
        const rules = [];
        afRulesContainer.querySelectorAll('.rule-row').forEach(row => {
            const k = row.querySelector('.af-key').value.trim(); const v = row.querySelector('.af-val').value.trim();
            if (k !== '') rules.push({ key: k, value: v });
        });
        fieldPositions[targetId].autoFill = { sourceId, rules, type: 'prefix' };
        alert(`設定を保存しました。`); autoFillModal.style.display = 'none';
    }

    function runAutoFillEngine(changedFieldId, newValue) {
        Object.values(fieldPositions).forEach(targetField => {
            if (targetField.autoFill && targetField.autoFill.sourceId === changedFieldId) {
                const config = targetField.autoFill; const valStr = String(newValue);
                for (const rule of config.rules) {
                    if (valStr.startsWith(rule.key)) { targetField.value = rule.value; break; }
                }
            }
        });
    }

    function updateValueInputForm() {
        valueInputForm.innerHTML = '';
        const dataSources = {}; const formItems = [];
        const assignedFieldIds = new Set();
        questions.forEach(q => q.choices.forEach(c => { if (c.fieldId) assignedFieldIds.add(c.fieldId); }));

        Object.values(fieldPositions).forEach(field => {
            if (field.dataSource) {
                if (!dataSources[field.dataSource]) dataSources[field.dataSource] = { name: field.dataSource, y: field.y, fields: [], dataSourceType: field.dataSourceType };
                dataSources[field.dataSource].fields.push(field);
                dataSources[field.dataSource].y = Math.min(dataSources[field.dataSource].y, field.y);
            } else if (field.type === 'text' && !assignedFieldIds.has(field.id)) {
                formItems.push({ type: 'textfield', data: field, y: field.y });
            }
        });

        for (const dsName in dataSources) formItems.push({ type: 'group', data: dataSources[dsName], y: dataSources[dsName].y });
        questions.forEach(q => {
            if (q.title && q.choices.length > 0) {
                const firstChoice = q.choices.find(c => c.fieldId && fieldPositions[c.fieldId]);
                const yPos = firstChoice ? fieldPositions[firstChoice.fieldId].y : Infinity;
                formItems.push({ type: 'question', data: q, y: yPos });
            }
        });
        formItems.sort((a, b) => a.y - b.y);

        formItems.forEach(item => {
            const itemDiv = document.createElement('div'); itemDiv.className = 'value-input-item';
            if (item.type === 'group') {
                const groupData = item.data;
                const label = document.createElement('label'); label.textContent = `${groupData.name}:`;
                const input = document.createElement('input'); input.type = 'text';
                itemDiv.appendChild(label); itemDiv.appendChild(input);

                if (groupData.dataSourceType === 'datetime') {
                    input.placeholder = 'カレンダーから日時を選択...'; input.readOnly = true;
                    input.addEventListener('change', (e) => handleGroupInputChange(groupData.name, e.target.value));
                    flatpickr(input, { enableTime: true, dateFormat: "Y/m/d H:i", locale: 'ja' });
                } else if (groupData.dataSourceType === 'char-split') {
                    input.placeholder = 'テキストを入力...';
                    input.addEventListener('input', (e) => handleCharSplitInputChange(groupData.name, e.target.value));
                } else if (groupData.dataSourceType === 'phone-split') {
                    input.placeholder = '09012345678';
                    input.addEventListener('input', (e) => handlePhoneSplitInputChange(groupData.name, e.target.value));
                } else if (groupData.dataSourceType === 'duplicate') {
                    input.placeholder = '共通入力...';
                    input.addEventListener('input', (e) => handleDuplicateInputChange(groupData.name, e.target.value));
                }
            } else if (item.type === 'textfield') {
                const fieldData = item.data;
                const label = document.createElement('label'); label.htmlFor = `input-${fieldData.id}`; label.textContent = `${fieldData.label}:`;
                let input;
                if (fieldData.type === 'textarea') {
                    input = document.createElement('textarea'); input.rows = 5; input.style.width = "100%"; input.style.resize = "vertical";
                } else { input = document.createElement('input'); input.type = 'text'; }
                input.id = `input-${fieldData.id}`; input.value = fieldData.value || '';
                input.addEventListener('input', (e) => { 
                    fieldData.value = e.target.value; 
                    runAutoFillEngine(fieldData.id, e.target.value); 
                    drawCanvasWithBoxes(); 
                });
                itemDiv.appendChild(label); itemDiv.appendChild(input);
            } else if (item.type === 'question') {
                const q = item.data; const label = document.createElement('label'); label.textContent = q.title; itemDiv.appendChild(label);
                const optionsContainer = document.createElement('div'); optionsContainer.className = 'radio-group-container';
                q.choices.forEach(c => {
                    if (!c.fieldId || !c.name) return;
                    const fieldData = fieldPositions[c.fieldId]; if (!fieldData) return;
                    const wrapper = document.createElement('div');
                    const input = document.createElement('input'); input.type = q.type; input.id = `input-${fieldData.id}`; input.name = q.id; input.checked = fieldData.value || false;
                    input.addEventListener('change', (e) => {
                        if (q.type === 'radio') q.choices.forEach(choice => { if (fieldPositions[choice.fieldId]) fieldPositions[choice.fieldId].value = false; });
                        fieldData.value = e.target.checked; drawCanvasWithBoxes();
                    });
                    const optionLabel = document.createElement('label'); optionLabel.htmlFor = `input-${fieldData.id}`; optionLabel.textContent = c.name;
                    wrapper.appendChild(input); wrapper.appendChild(optionLabel); optionsContainer.appendChild(wrapper);
                });
                itemDiv.appendChild(optionsContainer);
            }
            valueInputForm.appendChild(itemDiv);
        });
    }

    function renderQuestionBlock(question) {
        const block = document.createElement('div'); block.className = 'question-block'; block.dataset.questionId = question.id;
        block.innerHTML = `<button class="delete-question-btn">×</button><div class="form-group"><label>質問文</label><input type="text" class="question-title" value="${question.title}"></div><div class="form-group"><label>入力形式</label><select class="question-type"><option value="radio" ${question.type === 'radio' ? 'selected' : ''}>ラジオボタン</option><option value="checkbox" ${question.type === 'checkbox' ? 'selected' : ''}>チェックボックス</option></select></div><div class="form-group"><label>選択肢</label><div class="choices-list"></div><button class="add-choice-btn">＋ 選択肢を追加</button></div>`;
        questionsList.appendChild(block);
        block.querySelector('.delete-question-btn').addEventListener('click', () => { questions = questions.filter(q => q.id !== question.id); block.remove(); updateAllUnassignedSelectors(); updateValueInputForm(); });
        block.querySelector('.question-title').addEventListener('input', (e) => { question.title = e.target.value; updateValueInputForm(); });
        block.querySelector('.question-type').addEventListener('change', (e) => { question.type = e.target.value; updateValueInputForm(); });
        block.querySelector('.add-choice-btn').addEventListener('click', () => { const newChoice = { name: '', fieldId: null }; question.choices.push(newChoice); renderChoiceItem(block.querySelector('.choices-list'), question, newChoice); });
        question.choices.forEach(choice => renderChoiceItem(block.querySelector('.choices-list'), question, choice));
    }
    
    function renderChoiceItem(listContainer, question, choice) {
        const item = document.createElement('div'); item.className = 'choice-item';
        const unassignedSelector = createUnassignedSelector(choice.fieldId);
        item.innerHTML = `<input type="text" class="choice-name" placeholder="選択肢名" value="${choice.name}">`; item.prepend(unassignedSelector);
        listContainer.appendChild(item);
        item.querySelector('.choice-name').addEventListener('input', (e) => { choice.name = e.target.value; updateValueInputForm(); });
        unassignedSelector.addEventListener('change', (e) => { const oldFieldId = choice.fieldId; choice.fieldId = e.target.value || null; updateAllUnassignedSelectors(oldFieldId); updateValueInputForm(); });
    }
    
    function createUnassignedSelector(selectedFieldId) {
        const select = document.createElement('select'); select.innerHTML = '<option value="">-- 要素を選択 --</option>';
        const assignedFieldIds = new Set(); questions.forEach(q => q.choices.forEach(c => { if (c.fieldId && c.fieldId !== selectedFieldId) assignedFieldIds.add(c.fieldId); }));
        Object.values(fieldPositions).forEach(field => {
            if (!assignedFieldIds.has(field.id)) {
                const option = document.createElement('option'); option.value = field.id; option.textContent = field.label;
                if (field.id === selectedFieldId) option.selected = true;
                select.appendChild(option);
            }
        });
        return select;
    }
    
    function updateAllUnassignedSelectors() {
        document.querySelectorAll('#screen-B .question-block').forEach(block => {
            const questionId = block.dataset.questionId; const question = questions.find(q => q.id === questionId);
            if (question) { const listContainer = block.querySelector('.choices-list'); listContainer.innerHTML = ''; question.choices.forEach(choice => renderChoiceItem(listContainer, question, choice)); }
        });
    }

    function getCanvasMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function handleGroupInputChange(dataSourceName, inputValue) {
        const parsedData = parseDateTime(inputValue);
        if (!parsedData) {
            Object.values(fieldPositions).forEach(field => { if (field.dataSource === dataSourceName) field.value = ''; });
            drawCanvasWithBoxes(); return;
        }
        const ymd = parseInt(parsedData['year-ad'] + parsedData['month'].padStart(2, '0') + parsedData['day'].padStart(2, '0'));
        let currentEra = ymd >= 20190501 ? 'circle-reiwa' : ymd >= 19890108 ? 'circle-heisei' : ymd >= 19261225 ? 'circle-showa' : ymd >= 19120730 ? 'circle-taisho' : 'circle-meiji';

        Object.values(fieldPositions).forEach(field => {
            if (field.dataSource === dataSourceName && field.dataPart) {
                if (field.dataPart.includes('-split_')) {
                    const [baseRole, indexStr] = field.dataPart.split('_');
                    const index = parseInt(indexStr, 10);
                    let baseValue = parsedData[baseRole.replace('-split', '')];
                    if ((baseRole.includes('month') || baseRole.includes('day')) && baseValue) baseValue = baseValue.toString().padStart(2, ' ');
                    field.value = (baseValue && baseValue.length > index) ? baseValue[index] : '';
                } else if (field.dataPart.startsWith('circle-')) {
                     // 年号丸囲み判定
                     field.value = (field.dataPart === currentEra);
                } else {
                    field.value = parsedData[field.dataPart] || '';
                }
            }
        });
        drawCanvasWithBoxes();
    }

    function parseDateTime(dateTimeString) {
        const d = new Date(dateTimeString); if (isNaN(d.getTime())) return null;
        const year = d.getFullYear(); const month = d.getMonth() + 1; const day = d.getDate();
        const hour24 = d.getHours(); const minute = d.getMinutes();
        const yearWareki = year >= 2019 ? year - 2018 : year;
        const hourAM = (hour24 < 12) ? ((hour24 === 0) ? 12 : hour24) : '';
        const hourPM = (hour24 >= 12) ? ((hour24 === 12) ? 12 : hour24 - 12) : '';
        
        return {
            'year-ad': String(year), 'year-wareki': String(yearWareki), 'month': String(month), 'day': String(day),
            'hour-24': String(hour24), 'hour-am': String(hourAM), 'hour-pm': String(hourPM), 'minute': String(minute).padStart(2, '0')
        };
    }

    function setTodayDateToFields() {
        const today = new Date();
        const parsed = parseDateTime(today.toString());
        if(!parsed) return;
        
        const todayParts = { 'today-year-ad': parsed['year-ad'], 'today-year-wareki': parsed['year-wareki'], 'today-month': parsed['month'], 'today-day': parsed['day'] };
        Object.values(fieldPositions).forEach(field => {
            if (field.dataPart && todayParts.hasOwnProperty(field.dataPart)) field.value = todayParts[field.dataPart];
        });
    }

    function handleCharSplitInputChange(dataSourceName, inputValue) {
        const chars = inputValue.split('');
        const groupFields = Object.values(fieldPositions).filter(f => f.dataSource === dataSourceName);
        groupFields.forEach(field => field.value = '');
        chars.forEach((char, index) => {
            const targetField = groupFields.find(f => f.dataPart === `char_${index}`);
            if (targetField) targetField.value = char;
        });
        drawCanvasWithBoxes();
    }

    function handlePhoneSplitInputChange(dataSourceName, inputValue) {
        let val = inputValue.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[ー−]/g, '-');
        let parts = [];
        if (val.includes('-')) { parts = val.split('-'); }
        else {
            const d = val.replace(/\D/g, ''); const len = d.length;
            if (len === 11) parts = [d.slice(0, 3), d.slice(3, 7), d.slice(7)];
            else if (len === 10) parts = (d.startsWith('03') || d.startsWith('06')) ? [d.slice(0, 2), d.slice(2, 6), d.slice(6)] : [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
            else parts = [d];
        }
        const groupFields = Object.values(fieldPositions).filter(f => f.dataSource === dataSourceName);
        groupFields.forEach(field => field.value = '');
        parts.forEach((part, index) => {
            const targetField = groupFields.find(f => f.dataPart === `split_${index}`);
            if (targetField) targetField.value = part;
        });
        drawCanvasWithBoxes(); 
    }

    function handleDuplicateInputChange(dataSourceName, inputValue) {
        Object.values(fieldPositions).filter(f => f.dataSource === dataSourceName).forEach(field => field.value = inputValue);
        drawCanvasWithBoxes(); 
    }

    function duplicateField(direction) {
        if (!selectedFieldId || !fieldPositions[selectedFieldId]) return;
        const original = fieldPositions[selectedFieldId];
        const newId = `field_${Date.now()}`;
        const newField = JSON.parse(JSON.stringify(original));
        newField.id = newId;
        const match = original.label.match(/^(.*?)(\d+)$/);
        if (match) {
            const prefix = match[1]; let maxNum = 0;
            Object.values(fieldPositions).forEach(f => { if (f.label.startsWith(prefix)) { const m = f.label.match(/\d+$/); if (m) maxNum = Math.max(maxNum, parseInt(m[0], 10)); } });
            newField.label = `${prefix}${maxNum + 1}`;
        } else { newField.label = `${original.label}_copy`; }
        const margin = 0; 
        if (direction === 'right') newField.x = original.x + original.width + margin;
        else if (direction === 'left') newField.x = original.x - original.width - margin;
        else if (direction === 'bottom') newField.y = original.y + original.height + margin;
        else if (direction === 'top') newField.y = original.y - original.height - margin;
        fieldPositions[newId] = newField;
        selectedFieldId = newId; selectedFieldIds = [newId];
        drawCanvasWithBoxes(); updateValueInputForm(); updateFloatingControls();
    }

    function updateFloatingControls() {
        if (!selectedFieldId || !fieldPositions[selectedFieldId]) {
            if(floatingControls) floatingControls.style.display = 'none';
            if(quickDuplicateControls) quickDuplicateControls.style.display = 'none';
            return;
        }
        const pos = fieldPositions[selectedFieldId];
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / pdfPage.originalWidth;
        const scaleY = canvas.height / pdfPage.originalHeight;
        const fieldScreenX = rect.left + (pos.x * scaleX) + window.scrollX;
        const fieldScreenY = rect.top + (pos.y * scaleY) + window.scrollY;
        
        if (pos.type === 'textarea') {
            if(floatingControls) {
                floatingControls.style.display = 'block';
                floatingControls.style.left = `${fieldScreenX + pos.width * scaleX}px`;
                floatingControls.style.top = `${fieldScreenY - 30}px`;
            }
            if(floatingFontSize) floatingFontSize.value = pos.size || 10.5;
        } else { if(floatingControls) floatingControls.style.display = 'none'; }

        if (quickDuplicateControls) {
            quickDuplicateControls.style.display = 'block';
            quickDuplicateControls.style.width = `${pos.width * scaleX}px`;
            quickDuplicateControls.style.height = `${pos.height * scaleY}px`;
            quickDuplicateControls.style.left = `${fieldScreenX}px`;
            quickDuplicateControls.style.top = `${fieldScreenY}px`;
        }
    }

    function getWrappedLines(ctx, text, maxWidth) {
        const words = text.split(''); const lines = []; let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + word).width;
            if (width < maxWidth) currentLine += word;
            else { lines.push(currentLine); currentLine = word; }
        }
        lines.push(currentLine); return lines;
    }

    // PDF生成用のテキストラップ関数 (PDF-Libのフォントを使用)
    function wrapTextPdf(text, maxWidth, font, fontSize) {
        const lines = [];
        const paragraphs = text.split('\n');
        
        for (const paragraph of paragraphs) {
            let currentLine = '';
            for (let i = 0; i < paragraph.length; i++) {
                const char = paragraph[i];
                const testLine = currentLine + char;
                const width = font.widthOfTextAtSize(testLine, fontSize);
                if (width > maxWidth) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine);
        }
        return lines;
    }
});