
"use strict";

// ==========================================================
// SMART ENERGY METER
// FIREBASE + LOGIN + RESPONSIVE DASHBOARD
// ENERGI DITAMPILKAN DALAM kWh
// ==========================================================


// ==========================================================
// 1. FIREBASE CONFIGURATION
// ==========================================================

const firebaseConfig = {
    apiKey: "AIzaSyBKWpeSnxZ5NfcveYvYRhZB8oCdW6hCPBw",
    authDomain: "smart-energy-meter-bff7d.firebaseapp.com",
    databaseURL:
        "https://smart-energy-meter-bff7d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "smart-energy-meter-bff7d"
};


// ==========================================================
// 2. FIREBASE INITIALIZATION
// ==========================================================

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();


// ==========================================================
// 3. GLOBAL VARIABLES
// ==========================================================

let currentUser = null;
let dashboardStarted = false;

let powerChart = null;
let voltageChart = null;
let currentChart = null;
let monitorPowerChart = null;
let energyChart = null;

let currentVoltage = 0;
let currentCurrent = 0;
let currentPower = 0;

// Nilai energi dari Firebase diasumsikan dalam Wh.
let currentEnergy = 0;

let activeLimit = 900;
let lastSensorUpdate = 0;

const MAX_POINTS = 30;
const MAX_STATISTIC_SAMPLES = 100;

let powerData = [];
let historyData = [];

let dashboardListeners = [];
let clockInterval = null;
let statusInterval = null;


// ==========================================================
// 4. HELPER GLOBAL
// ==========================================================

function getElement(id) {
    return document.getElementById(id);
}

function toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, decimals = 2) {
    return toNumber(value).toFixed(decimals);
}

// Konversi Wh ke kWh.
// Contoh: 1250 Wh = 1.250 kWh.
function toKwh(energyWh) {
    return toNumber(energyWh) / 1000;
}

function formatKwh(energyWh) {
    return toKwh(energyWh).toFixed(3);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value;
    }
}

function setBadge(id, text, className) {
    const element = getElement(id);

    if (!element) return;

    element.textContent = text;
    element.className = "badge " + className;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==========================================================
// 5. FIREBASE AUTHENTICATION STATE
// ==========================================================

auth.onAuthStateChanged(function(user) {
    currentUser = user;

    const loginPage = getElement("loginPage");
    const appContent = getElement("appContent");
    const userEmail = getElement("firebaseUserEmail");

    if (user) {
        if (loginPage) {
            loginPage.classList.add("d-none");
        }

        if (appContent) {
            appContent.classList.remove("d-none");
        }

        if (userEmail) {
            userEmail.textContent = user.email || "";
        }

        console.log("Firebase login berhasil:", user.email);

        startDashboard();
    } else {
        if (appContent) {
            appContent.classList.add("d-none");
        }

        if (loginPage) {
            loginPage.classList.remove("d-none");
        }

        if (userEmail) {
            userEmail.textContent = "";
        }

        stopDashboard();

        console.log("Belum ada pengguna yang login.");
    }
});


// ==========================================================
// 6. LOGIN FORM
// ==========================================================

const loginForm = getElement("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        const email = getElement("loginEmail")?.value.trim();
        const password = getElement("loginPassword")?.value;

        const loginButton = getElement("loginButton");
        const loginError = getElement("loginError");

        if (loginError) {
            loginError.textContent = "";
            loginError.classList.add("d-none");
        }

        if (!email || !password) {
            showLoginError("Email dan password wajib diisi.");
            return;
        }

        try {
            if (loginButton) {
                loginButton.disabled = true;

                loginButton.innerHTML =
                    '<span class="spinner-border spinner-border-sm me-2"></span>' +
                    "Memproses...";
            }

            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            console.error("Firebase Login Error:", error);

            showLoginError(getLoginErrorMessage(error));
        } finally {
            if (loginButton) {
                loginButton.disabled = false;

                loginButton.innerHTML =
                    '<i class="bi bi-box-arrow-in-right"></i> Login';
            }
        }
    });
}


// ==========================================================
// 7. LOGIN ERROR
// ==========================================================

function showLoginError(message) {
    const loginError = getElement("loginError");

    if (!loginError) return;

    loginError.textContent = message;
    loginError.classList.remove("d-none");
}

function getLoginErrorMessage(error) {
    switch (error.code) {
        case "auth/invalid-email":
            return "Format email tidak valid.";

        case "auth/user-disabled":
            return "Akun Firebase ini dinonaktifkan.";

        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-login-credentials":
            return "Email atau password salah.";

        case "auth/too-many-requests":
            return "Terlalu banyak percobaan login. Coba lagi nanti.";

        case "auth/network-request-failed":
            return "Koneksi internet bermasalah.";

        default:
            return "Login gagal. Periksa email, password, dan koneksi internet.";
    }
}


// ==========================================================
// 8. SHOW / HIDE PASSWORD
// ==========================================================

const togglePassword = getElement("togglePassword");

if (togglePassword) {
    togglePassword.addEventListener("click", function() {
        const password = getElement("loginPassword");
        const icon = togglePassword.querySelector("i");

        if (!password || !icon) return;

        if (password.type === "password") {
            password.type = "text";
            icon.className = "bi bi-eye-slash";
        } else {
            password.type = "password";
            icon.className = "bi bi-eye";
        }
    });
}


// ==========================================================
// 9. LOGOUT
// ==========================================================

async function logout() {
    try {
        await auth.signOut();

        console.log("Logout berhasil.");
    } catch (error) {
        console.error("Firebase Logout Error:", error);

        alert("Logout gagal. Silakan coba lagi.");
    }
}

window.logout = logout;


// ==========================================================
// 10. START / STOP DASHBOARD
// ==========================================================

function startDashboard() {
    if (dashboardStarted) return;

    dashboardStarted = true;

    initializeDashboard();
}

function stopDashboard() {
    if (!dashboardStarted) return;

    dashboardListeners.forEach(function(listener) {
        listener.ref.off(listener.event, listener.callback);
    });

    dashboardListeners = [];

    if (clockInterval !== null) {
        clearInterval(clockInterval);
        clockInterval = null;
    }

    if (statusInterval !== null) {
        clearInterval(statusInterval);
        statusInterval = null;
    }

    [
        powerChart,
        voltageChart,
        currentChart,
        monitorPowerChart,
        energyChart
    ].forEach(function(chart) {
        if (chart) {
            chart.destroy();
        }
    });

    powerChart = null;
    voltageChart = null;
    currentChart = null;
    monitorPowerChart = null;
    energyChart = null;

    dashboardStarted = false;
}


// ==========================================================
// 11. DASHBOARD INITIALIZATION
// ==========================================================

function initializeDashboard() {

    // ------------------------------------------------------
    // CHART DATA
    // ------------------------------------------------------

    const chartLabels = [];
    const voltageValues = [];
    const currentValues = [];
    const powerValues = [];

    // Grafik energi menggunakan kWh.
    const energyValues = [];


    // ======================================================
    // PAGE NAVIGATION
    // ======================================================

    window.showPage = function(pageId) {
        if (!currentUser) return;

        document.querySelectorAll(".page").forEach(function(page) {
            page.classList.add("d-none");
        });

        const target = getElement(pageId);

        if (target) {
            target.classList.remove("d-none");
        }

        // Tandai menu aktif.
        document.querySelectorAll(".navbar .nav-link").forEach(function(link) {
            link.classList.remove("active");

            const handler = link.getAttribute("onclick") || "";

            if (handler.includes("'" + pageId + "'")) {
                link.classList.add("active");
            }
        });

        // Tutup hamburger menu setelah menu dipilih di mobile.
        const navbarMenu = getElement("navbarMenu");

        if (
            navbarMenu &&
            navbarMenu.classList.contains("show") &&
            typeof bootstrap !== "undefined"
        ) {
            const collapse = bootstrap.Collapse.getOrCreateInstance(navbarMenu);
            collapse.hide();
        }

        // Perbarui ukuran grafik ketika halaman ditampilkan.
        setTimeout(resizeCharts, 150);
    };


    // ======================================================
    // CLOCK
    // ======================================================

    function updateClock() {
        const now = new Date();

        setText(
            "tanggal",
            now.toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "long",
                year: "numeric"
            })
        );

        setText(
            "jam",
            now.toLocaleTimeString("id-ID")
        );
    }

    updateClock();

    clockInterval = setInterval(updateClock, 1000);


    // ======================================================
    // CHART OPTIONS
    // ======================================================

    function chartOptions(yTitle) {
        return {
            responsive: true,

            // Menyesuaikan tinggi dengan container CSS.
            maintainAspectRatio: false,

            animation: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: true,
                    position: "top"
                },

                tooltip: {
                    enabled: true
                }
            },

            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Waktu"
                    },

                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0
                    }
                },

                y: {
                    beginAtZero: true,

                    title: {
                        display: true,
                        text: yTitle
                    }
                }
            }
        };
    }


    // ======================================================
    // CREATE CHART
    // ======================================================

    function createLineChart(
        canvasId,
        label,
        dataArray,
        yTitle,
        fill = false
    ) {
        const canvas = getElement(canvasId);

        if (!canvas || typeof Chart === "undefined") {
            console.warn("Canvas atau Chart.js tidak tersedia:", canvasId);
            return null;
        }

        return new Chart(canvas, {
            type: "line",

            data: {
                labels: chartLabels,

                datasets: [{
                    label: label,
                    data: dataArray,
                    borderWidth: 2.5,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    tension: 0.3,
                    fill: fill
                }]
            },

            options: chartOptions(yTitle)
        });
    }


    // ======================================================
    // CREATE ALL CHARTS
    // ======================================================

    function createCharts() {
        powerChart = createLineChart(
            "powerChart",
            "Daya (W)",
            powerValues,
            "Daya (W)",
            true
        );

        voltageChart = createLineChart(
            "voltageChart",
            "Tegangan (V)",
            voltageValues,
            "Tegangan (V)"
        );

        currentChart = createLineChart(
            "currentChart",
            "Arus (A)",
            currentValues,
            "Arus (A)"
        );

        monitorPowerChart = createLineChart(
            "monitorPowerChart",
            "Daya (W)",
            powerValues,
            "Daya (W)"
        );

        energyChart = createLineChart(
            "energyChart",
            "Energi (kWh)",
            energyValues,
            "Energi (kWh)"
        );
    }

    createCharts();


    // ======================================================
    // UPDATE CHARTS
    // ======================================================

    function updateCharts() {
        [
            powerChart,
            voltageChart,
            currentChart,
            monitorPowerChart,
            energyChart
        ].forEach(function(chart) {
            if (chart) {
                chart.update("none");
            }
        });
    }


    // ======================================================
    // RESIZE CHARTS
    // ======================================================

    function resizeCharts() {
        [
            powerChart,
            voltageChart,
            currentChart,
            monitorPowerChart,
            energyChart
        ].forEach(function(chart) {
            if (chart) {
                chart.resize();
            }
        });
    }


    // ======================================================
    // REGISTER FIREBASE LISTENER
    // ======================================================

    function listen(ref, event, callback) {
        ref.on(event, callback);

        dashboardListeners.push({
            ref: ref,
            event: event,
            callback: callback
        });
    }


    // ======================================================
    // FIREBASE CONNECTION STATUS
    // ======================================================

    listen(
        db.ref(".info/connected"),
        "value",
        function(snapshot) {
            const connected = snapshot.val() === true;

            if (connected) {
                setBadge(
                    "statusFirebase",
                    "Firebase Connected",
                    "bg-success"
                );

                setBadge(
                    "firebaseStatus",
                    "Online",
                    "bg-success"
                );
            } else {
                setBadge(
                    "statusFirebase",
                    "Disconnected",
                    "bg-danger"
                );

                setBadge(
                    "firebaseStatus",
                    "Offline",
                    "bg-danger"
                );
            }
        }
    );


    // ======================================================
    // SENSOR DATA
    // ======================================================

    listen(
        db.ref("sensor"),
        "value",
        function(snapshot) {
            const data = snapshot.val();

            if (!data || typeof data !== "object") {
                console.warn("Data sensor belum tersedia.");
                return;
            }

            // ----------------------------------------------
            // READ DATA FROM FIREBASE
            // ----------------------------------------------

            currentVoltage = toNumber(data.voltage);
            currentCurrent = toNumber(data.current);
            currentPower = toNumber(data.power);

            // Data energi dari ESP32/PZEM diasumsikan dalam Wh.
            currentEnergy = toNumber(data.energy);

            lastSensorUpdate = Date.now();


            // ----------------------------------------------
            // DASHBOARD VALUES
            // ----------------------------------------------

            setText("voltage", formatNumber(currentVoltage, 2));
            setText("current", formatNumber(currentCurrent, 2));
            setText("power", formatNumber(currentPower, 2));

            // Energi hanya ditampilkan dalam kWh.
            setText("energy", formatKwh(currentEnergy));


            // ----------------------------------------------
            // MONITORING VALUES
            // ----------------------------------------------

            setText(
                "monitorVoltage",
                formatNumber(currentVoltage, 2)
            );

            setText(
                "monitorCurrent",
                formatNumber(currentCurrent, 2)
            );

            setText(
                "monitorPower",
                formatNumber(currentPower, 2)
            );

            setText(
                "monitorEnergy",
                formatKwh(currentEnergy)
            );


            // ----------------------------------------------
            // UPDATE CHART DATA
            // ----------------------------------------------

            const time = new Date().toLocaleTimeString("id-ID");

            chartLabels.push(time);
            voltageValues.push(currentVoltage);
            currentValues.push(currentCurrent);
            powerValues.push(currentPower);

            // Wh dikonversi ke kWh untuk grafik.
            energyValues.push(toKwh(currentEnergy));


            // ----------------------------------------------
            // LIMIT CHART POINTS
            // ----------------------------------------------

            if (chartLabels.length > MAX_POINTS) {
                chartLabels.shift();
                voltageValues.shift();
                currentValues.shift();
                powerValues.shift();
                energyValues.shift();
            }


            // ----------------------------------------------
            // POWER STATISTICS DATA
            // ----------------------------------------------

            powerData.push(currentPower);

            if (powerData.length > MAX_STATISTIC_SAMPLES) {
                powerData.shift();
            }


            // ----------------------------------------------
            // UPDATE UI
            // ----------------------------------------------

            updateStatistics();
            updateDeviceStatus();
            updateAlert();
            updateCharts();
        }
    );


    // ======================================================
    // DEVICE STATUS
    // ======================================================

    function updateDeviceStatus() {
        const online =
            lastSensorUpdate > 0 &&
            (Date.now() - lastSensorUpdate) < 10000;

        if (online) {
            setBadge("espStatus", "Online", "bg-success");
            setBadge("pzemStatus", "Online", "bg-success");
        } else {
            setBadge("espStatus", "Offline", "bg-danger");
            setBadge("pzemStatus", "Periksa Data", "bg-warning text-dark");
        }

        setText(
            "lastUpdate",
            lastSensorUpdate > 0
                ? new Date(lastSensorUpdate).toLocaleTimeString("id-ID")
                : "-"
        );
    }

    statusInterval = setInterval(updateDeviceStatus, 2000);


    // ======================================================
    // POWER STATISTICS
    // ======================================================

    function updateStatistics() {
        if (powerData.length === 0) return;

        const sum = powerData.reduce(function(total, value) {
            return total + value;
        }, 0);

        const average = sum / powerData.length;
        const maximum = Math.max(...powerData);
        const minimum = Math.min(...powerData);

        setText("avgPower", formatNumber(average, 2));
        setText("maxPower", formatNumber(maximum, 2));
        setText("minPower", formatNumber(minimum, 2));
        setText("sampleCount", String(powerData.length));
    }


    // ======================================================
    // POWER LIMIT SETTINGS
    // ======================================================

    listen(
        db.ref("setting/batas"),
        "value",
        function(snapshot) {
            if (!snapshot.exists()) return;

            activeLimit = toNumber(snapshot.val(), 900);

            setText("batasAktif", formatNumber(activeLimit, 0));
            setText("alertLimit", formatNumber(activeLimit, 0));

            const inputBatas = getElement("inputBatas");

            if (
                inputBatas &&
                document.activeElement !== inputBatas
            ) {
                inputBatas.value = activeLimit;
            }

            updateAlert();
        }
    );


    // ======================================================
    // SAVE POWER LIMIT
    // ======================================================

    window.simpanBatas = async function() {
        const input = getElement("inputBatas");

        if (!input) return;

        const batas = Number(input.value);

        if (
            input.value.trim() === "" ||
            !Number.isFinite(batas) ||
            batas < 0
        ) {
            alert("Masukkan batas daya yang valid.");
            return;
        }

        try {
            await db.ref("setting/batas").set(batas);

            alert("Pengaturan berhasil disimpan.");
        } catch (error) {
            console.error("Gagal menyimpan batas daya:", error);

            alert(
                "Pengaturan gagal disimpan. Periksa koneksi dan izin Firebase."
            );
        }
    };


    // ======================================================
    // ALERT / NOTIFICATION
    // ======================================================

    function updateAlert() {
        const overLimit = currentPower > activeLimit;

        const alertBox = getElement("alertBox");
        const dashboardAlert = getElement("dashboardAlert");

        const alertTitle = getElement("alertTitle");
        const alertMessage = getElement("alertMessage");

        const dashboardAlertTitle =
            getElement("dashboardAlertTitle");

        const dashboardAlertText =
            getElement("dashboardAlertText");


        setText("alertLimit", formatNumber(activeLimit, 0));


        if (overLimit) {
            if (alertBox) {
                alertBox.className = "alert alert-danger";
            }

            setText(
                "alertTitle",
                "Peringatan Batas Daya"
            );

            setText(
                "alertMessage",
                "Daya saat ini " +
                    formatNumber(currentPower, 2) +
                    " W, melebihi batas " +
                    formatNumber(activeLimit, 2) +
                    " W."
            );

            if (dashboardAlert) {
                dashboardAlert.classList.remove("d-none");
                dashboardAlert.className =
                    "alert alert-danger mt-4";
            }

            setText(
                "dashboardAlertTitle",
                "Peringatan Batas Daya"
            );

            setText(
                "dashboardAlertText",
                "Daya saat ini " +
                    formatNumber(currentPower, 2) +
                    " W melebihi batas " +
                    formatNumber(activeLimit, 2) +
                    " W."
            );
        } else {
            if (alertBox) {
                alertBox.className = "alert alert-success";
            }

            setText("alertTitle", "Kondisi Normal");

            setText(
                "alertMessage",
                "Konsumsi daya berada di bawah batas yang ditentukan."
            );

            if (dashboardAlert) {
                dashboardAlert.classList.add("d-none");
            }
        }
    }


    // ======================================================
    // HISTORY DATA
    // ======================================================

    listen(
        db.ref("history"),
        "value",
        function(snapshot) {
            const table = getElement("historyTable");

            if (!table) return;

            table.innerHTML = "";
            historyData = [];

            if (!snapshot.exists()) {
                table.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-muted">
                            Belum ada data riwayat.
                        </td>
                    </tr>
                `;

                return;
            }

            snapshot.forEach(function(item) {
                const value = item.val();

                if (!value || typeof value !== "object") {
                    return;
                }

                const timestamp =
                    value.timestamp ?? item.key ?? "";

                const voltage = toNumber(value.voltage);
                const current = toNumber(value.current);
                const power = toNumber(value.power);

                // Asumsi: energy pada /history masih disimpan dalam Wh.
                const energyKwh = toKwh(value.energy);

                historyData.push({
                    timestamp: timestamp,
                    voltage: voltage,
                    current: current,
                    power: power,
                    energyKwh: energyKwh
                });

                const dateText = formatHistoryDate(timestamp);

                const row = document.createElement("tr");

                [
                    dateText,
                    formatNumber(voltage, 2),
                    formatNumber(current, 2),
                    formatNumber(power, 2),
                    energyKwh.toFixed(3)
                ].forEach(function(text) {
                    const cell = document.createElement("td");

                    cell.textContent = text;
                    row.appendChild(cell);
                });

                table.appendChild(row);
            });

            if (historyData.length === 0) {
                table.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-muted">
                            Belum ada data riwayat.
                        </td>
                    </tr>
                `;
            }
        }
    );


    // ======================================================
    // FORMAT HISTORY DATE
    // ======================================================

    function formatHistoryDate(timestamp) {
        if (timestamp === null || timestamp === undefined || timestamp === "") {
            return "-";
        }

        // Mendukung timestamp dalam milidetik.
        if (
            typeof timestamp === "number" ||
            /^\d{10,13}$/.test(String(timestamp))
        ) {
            let numericTimestamp = Number(timestamp);

            // Timestamp 10 digit biasanya dalam detik.
            if (String(timestamp).length === 10) {
                numericTimestamp *= 1000;
            }

            const dateFromNumber = new Date(numericTimestamp);

            if (!Number.isNaN(dateFromNumber.getTime())) {
                return dateFromNumber.toLocaleString("id-ID");
            }
        }

        const date = new Date(timestamp);

        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString("id-ID");
        }

        return String(timestamp);
    }


    // ======================================================
    // EXPORT HISTORY CSV
    // ENERGI DALAM kWh
    // ======================================================

    window.exportHistoryCSV = function() {
        if (historyData.length === 0) {
            alert("Belum ada data riwayat untuk diekspor.");
            return;
        }

        const rows = [
            [
                "Waktu",
                "Tegangan (V)",
                "Arus (A)",
                "Daya (W)",
                "Energi (kWh)"
            ]
        ];

        historyData.forEach(function(item) {
            rows.push([
                item.timestamp,
                item.voltage,
                item.current,
                item.power,
                item.energyKwh.toFixed(3)
            ]);
        });

        const csv = rows.map(function(row) {
            return row.map(function(value) {
                return '"' +
                    String(value ?? "").replace(/"/g, '""') +
                    '"';
            }).join(",");
        }).join("\r\n");

        const blob = new Blob(
            ["\uFEFF", csv],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "riwayat-smart-energy-meter.csv";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(function() {
            URL.revokeObjectURL(url);
        }, 1000);
    };


    // ======================================================
    // INITIAL PAGE
    // ======================================================

    window.showPage("dashboardPage");


    // ======================================================
    // INITIAL CHART RESIZE
    // ======================================================

    setTimeout(resizeCharts, 300);
}


// ==========================================================
// END OF SCRIPT
// ==========================================================
