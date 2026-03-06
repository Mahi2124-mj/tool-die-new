"""
DIE HEALTH MONITORING SYSTEM - MAINTENANCE 2.0
Complete Backend with Supabase Integration
"""

import os
import sys
import time
import json
import re
import hashlib
import secrets
import threading
from datetime import datetime, date, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, session, send_file
from flask_cors import CORS
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Keep a stable fallback key in local/dev mode so sessions survive server restarts.
# In production, always set SECRET_KEY in environment.
app.secret_key = os.getenv('SECRET_KEY') or 'dev-secret-key-change-me'

# Allow local frontend dev ports (3000/3001) and optional env override.
cors_origins = [
    origin.strip()
    for origin in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:3001').split(',')
    if origin.strip()
]
CORS(
    app,
    supports_credentials=True,
    origins=cors_origins,
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type', 'Authorization']
)

# Supabase Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_KEY')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
HAS_SERVICE_ROLE_KEY = bool(os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# ==================== CONFIGURATION ====================
PLC_IP = os.getenv('PLC_IP', '192.168.10.52')
PLC_PORT = int(os.getenv('PLC_PORT', '502'))
PLC_PROTOCOL = os.getenv('PLC_PROTOCOL', '4E').upper()
PLC_SCAN_INTERVAL = float(os.getenv('PLC_SCAN_INTERVAL', '0.1'))
PLC_MONITOR_ENABLED = os.getenv('PLC_MONITOR_ENABLED', 'true').lower() == 'true'
PLC_RECONNECT_DELAY = float(os.getenv('PLC_RECONNECT_DELAY', '2'))
PLC_MAX_RECONNECT_DELAY = float(os.getenv('PLC_MAX_RECONNECT_DELAY', '30'))

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
SPARE_MASTER_FILE = Path(__file__).resolve().parent / 'spare_master.json'
spare_master_lock = threading.Lock()
TOOL_COST_FILE = Path(__file__).resolve().parent / 'tool_costs.json'
tool_cost_lock = threading.Lock()

# ==================== GLOBAL VARIABLES ====================
system_status = {
    'plc_connected': False,
    'last_plc_read': None,
    'total_strokes': 0,
    'start_time': datetime.now().isoformat(),
    'uptime': 0
}

previous_states = {}
plc_connected = False
monitoring_active = True
plc_thread = None
active_die_cache = {}
last_cache_update = 0.0
ACTIVE_DIE_CACHE_TTL = float(os.getenv('ACTIVE_DIE_CACHE_TTL', '2'))
plc_machine_map_cache = {}
last_plc_machine_map_update = 0.0

def protocol_candidates():
    """Return protocol attempts in order."""
    if PLC_PROTOCOL in ('3E', '4E'):
        return [PLC_PROTOCOL]
    return ['4E', '3E']

def create_plc_client(pymcprotocol_module, protocol):
    client = pymcprotocol_module.Type4E() if protocol == '4E' else pymcprotocol_module.Type3E()
    # Use binary communication if supported by installed pymcprotocol version.
    try:
        client.setaccessopt(commtype='binary')
    except Exception:
        pass
    return client

# ==================== ROLE PERMISSIONS ====================
ROLE_PERMISSIONS = {
    'production': {
        'view_dashboard': True,
        'view_machines': True,
        'view_dies': True,
        'view_tickets': True,
        'edit_die_config': True,
        'edit_dies': False,
        'create_tickets': False,
        'assign_tickets': False,
        'do_repair': False,
        'quality_check': False,
        'manage_checks': False,
        'manage_users': False
    },
    'maintenance': {
        'view_dashboard': True,
        'view_machines': True,
        'view_dies': True,
        'view_tickets': True,
        'edit_die_config': True,
        'edit_dies': False,
        'create_tickets': True,
        'assign_tickets': True,
        'do_repair': True,
        'quality_check': False,
        'manage_checks': False,
        'manage_users': False
    },
    'quality': {
        'view_dashboard': True,
        'view_machines': True,
        'view_dies': True,
        'view_tickets': True,
        'edit_die_config': False,
        'edit_dies': False,
        'create_tickets': False,
        'assign_tickets': False,
        'do_repair': False,
        'quality_check': True,
        'manage_checks': False,
        'manage_users': False
    },
    'admin': {
        'view_dashboard': True,
        'view_machines': True,
        'view_dies': True,
        'view_tickets': True,
        'edit_die_config': True,
        'edit_dies': True,
        'create_tickets': True,
        'assign_tickets': True,
        'do_repair': True,
        'quality_check': True,
        'manage_checks': True,
        'manage_users': True
    },
    'management': {
        'view_dashboard': True,
        'view_machines': False,
        'view_dies': True,
        'view_tickets': False,
        'edit_die_config': False,
        'edit_dies': False,
        'create_tickets': False,
        'assign_tickets': False,
        'do_repair': False,
        'quality_check': False,
        'manage_checks': False,
        'manage_users': False
    }
}

# Dev fallback users (used only when DB users are unavailable and enabled).
DEV_DEFAULT_USERS = {
    'production': {'password': 'prod123', 'role': 'production', 'full_name': 'Production User'},
    'maintenance': {'password': 'maint123', 'role': 'maintenance', 'full_name': 'Maintenance User'},
    'quality': {'password': 'quality123', 'role': 'quality', 'full_name': 'Quality User'},
    'admin': {'password': 'admin123', 'role': 'admin', 'full_name': 'Admin User'},
    'management': {'password': 'mgmt123', 'role': 'management', 'full_name': 'Management User'}
}
ALLOWED_ROLES = set(ROLE_PERMISSIONS.keys())

# ==================== AUTH DECORATORS ====================
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'success': False, 'error': 'Login required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def role_required(permission):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return jsonify({'success': False, 'error': 'Login required'}), 401
            
            user_role = session['user']['role']
            if not ROLE_PERMISSIONS.get(user_role, {}).get(permission, False):
                return jsonify({'success': False, 'error': 'Permission denied'}), 403
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# ==================== HELPER FUNCTIONS ====================
def hash_password(password):
    """Hash password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def parse_optional_int(value):
    """Convert empty/invalid numeric input to None, otherwise int."""
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

def parse_optional_float(value):
    """Convert empty/invalid numeric input to None, otherwise float."""
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def load_spare_master():
    """Load spare master list from local JSON file."""
    with spare_master_lock:
        if not SPARE_MASTER_FILE.exists():
            return []
        try:
            data = json.loads(SPARE_MASTER_FILE.read_text(encoding='utf-8'))
            if isinstance(data, list):
                return data
        except Exception:
            pass
        return []

def save_spare_master(spares):
    """Persist spare master list to local JSON file."""
    with spare_master_lock:
        SPARE_MASTER_FILE.write_text(
            json.dumps(spares, ensure_ascii=True, indent=2),
            encoding='utf-8'
        )

def load_tool_costs():
    """Load base tool cost map {die_id: cost} from local JSON file."""
    with tool_cost_lock:
        if not TOOL_COST_FILE.exists():
            return {}
        try:
            raw = json.loads(TOOL_COST_FILE.read_text(encoding='utf-8'))
            if isinstance(raw, dict):
                parsed = {}
                for k, v in raw.items():
                    num = parse_optional_float(v)
                    if num is not None and num >= 0:
                        parsed[str(k)] = num
                return parsed
        except Exception:
            pass
        return {}

def save_tool_costs(cost_map):
    """Persist base tool cost map {die_id: cost} to local JSON file."""
    with tool_cost_lock:
        TOOL_COST_FILE.write_text(
            json.dumps(cost_map, ensure_ascii=True, indent=2),
            encoding='utf-8'
        )

def get_current_shift():
    """Get current shift based on time"""
    hour = datetime.now().hour
    if 6 <= hour < 14:
        return 'A'
    elif 14 <= hour < 22:
        return 'B'
    else:
        return 'C'

def is_transient_db_error(err):
    msg = str(err).lower()
    return (
        '10035' in msg or
        'timed out' in msg or
        'connection' in msg or
        'socket' in msg or
        'unexpected_eof_while_reading' in msg or
        'eof occurred in violation of protocol' in msg or
        'ssl' in msg
    )

def db_retry(operation, retries=5, delay=0.1):
    """Retry transient Supabase/network errors."""
    last_error = None
    for attempt in range(retries):
        try:
            return operation()
        except Exception as err:
            last_error = err
            if (not is_transient_db_error(err)) or attempt == retries - 1:
                raise
            time.sleep(delay * (attempt + 1))
    raise last_error

def update_active_die_cache():
    """Cache active die mapping to reduce DB load in PLC scan loop."""
    global active_die_cache, last_cache_update

    now = time.time()
    if (now - last_cache_update) < ACTIVE_DIE_CACHE_TTL:
        return active_die_cache

    try:
        active_dies = db_retry(lambda: supabase.table('dies')\
            .select('id, current_machine_id')\
            .eq('status', 'In-Use')\
            .execute())

        die_by_machine = {}
        for d in active_dies.data:
            machine_id = d.get('current_machine_id')
            if machine_id:
                die_by_machine[machine_id] = d['id']

        active_die_cache = die_by_machine
        last_cache_update = now
    except Exception as e:
        print(f"[CACHE] Active die cache update failed: {e}")

    return active_die_cache

def update_plc_machine_map_cache():
    """
    Build mapping from PLC input address to machine_id.
    Example: if plc_slave_id=1 => address M10 maps to that machine id.
    """
    global plc_machine_map_cache, last_plc_machine_map_update

    now = time.time()
    if (now - last_plc_machine_map_update) < ACTIVE_DIE_CACHE_TTL:
        return plc_machine_map_cache

    # Default direct zone mapping: M10->1, M11->2 ... M36->27
    mapping = {addr: (addr - 9) for addr in range(10, 37)}

    try:
        machines = db_retry(lambda: supabase.table('machines')\
            .select('id, plc_slave_id')\
            .eq('is_active', True)\
            .execute())

        # If machine master exists, override with configured IDs.
        for machine in machines.data:
            slave_id = machine.get('plc_slave_id')
            machine_id = machine.get('id')
            if slave_id is None or machine_id is None:
                continue

            # Read block starts at M10, so M10 == slave_id 1
            addr = int(slave_id) + 9
            mapping[addr] = machine_id

        plc_machine_map_cache = mapping
        last_plc_machine_map_update = now
    except Exception as e:
        print(f"[CACHE] PLC machine map update failed: {e}")

    return plc_machine_map_cache

def log_to_history(die_id, event_type, description, ticket_number=None, machine_id=None):
    """Add entry to die history"""
    try:
        supabase.table('die_history').insert({
            'die_id': die_id,
            'machine_id': machine_id,
            'event_type': event_type,
            'ticket_number': ticket_number,
            'description': description,
            'created_by': session.get('user', {}).get('username', 'System')
        }).execute()
    except Exception as e:
        print(f"[HISTORY ERROR] {e}")

# ==================== AUTH ROUTES ====================
@app.route('/', methods=['GET'])
def health_root():
    """Basic health route for browser/manual checks."""
    return jsonify({
        'success': True,
        'service': 'Die Health Monitoring Backend',
        'status': 'running',
        'time': datetime.now().isoformat()
    })

@app.route('/api/auth/login', methods=['POST'])
def login():
    """User login"""
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400
    
    try:
        # Get user from Supabase
        result = db_retry(lambda: supabase.table('users')\
            .select('*')\
            .eq('username', username)\
            .eq('is_active', True)\
            .execute())
        
        if not result.data:
            # Optional dev fallback when users table is empty/unavailable.
            allow_dev_fallback = os.getenv('ALLOW_DEV_FALLBACK_LOGIN', 'true').lower() == 'true'
            dev_user = DEV_DEFAULT_USERS.get(username) if allow_dev_fallback else None
            if dev_user and password == dev_user['password']:
                session['user'] = {
                    'id': f"dev-{username}",
                    'username': username,
                    'role': dev_user['role'],
                    'full_name': dev_user['full_name']
                }
                return jsonify({
                    'success': True,
                    'data': {
                        'id': f"dev-{username}",
                        'username': username,
                        'role': dev_user['role'],
                        'full_name': dev_user['full_name'],
                        'permissions': ROLE_PERMISSIONS.get(dev_user['role'], {})
                    }
                })
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
        
        user = result.data[0]
        hashed = hash_password(password)
        
        if hashed != user['password_hash']:
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
        
        # Set session
        session['user'] = {
            'id': user['id'],
            'username': user['username'],
            'role': user['role'],
            'full_name': user['full_name']
        }
        
        return jsonify({
            'success': True,
            'data': {
                'id': user['id'],
                'username': user['username'],
                'role': user['role'],
                'full_name': user['full_name'],
                'permissions': ROLE_PERMISSIONS.get(user['role'], {})
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """User logout"""
    session.clear()
    return jsonify({'success': True})

@app.route('/api/auth/me', methods=['GET'])
def get_current_user():
    """Get current logged in user"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    
    return jsonify({
        'success': True,
        'data': session['user']
    })

@app.route('/api/auth/permissions', methods=['GET'])
@login_required
def get_permissions():
    """Get permissions for current user"""
    user_role = session['user']['role']
    return jsonify({
        'success': True,
        'data': ROLE_PERMISSIONS.get(user_role, {})
    })

# ==================== DASHBOARD ROUTES ====================
@app.route('/api/dashboard', methods=['GET'])
@login_required
def get_dashboard():
    """Get dashboard statistics"""
    try:
        today = date.today().isoformat()
        ten_min_ago = (datetime.now() - timedelta(minutes=10)).isoformat()
        
        # Get today's production by shift
        prod_result = db_retry(lambda: supabase.table('daily_production')\
            .select('shift, stroke_count')\
            .eq('production_date', today)\
            .execute())
        
        shift_totals = {'A': 0, 'B': 0, 'C': 0}
        today_total = 0
        
        for row in prod_result.data:
            shift_totals[row['shift']] += row['stroke_count']
            today_total += row['stroke_count']
        
        # Get active dies
        active_dies = db_retry(lambda: supabase.table('dies')\
            .select('id')\
            .eq('status', 'In-Use')\
            .execute())
        
        # Get open tickets
        open_tickets = db_retry(lambda: supabase.table('tickets')\
            .select('id')\
            .in_('status', ['OPEN', 'IN_PROGRESS', 'QUALITY_CHECK', 'REWORK'])\
            .execute())
        
        # Get machines status
        machines = db_retry(lambda: supabase.table('machines')\
            .select('id')\
            .eq('is_active', True)\
            .execute())

        # Last 10-minute average SPM by line (Line 1/2/3)
        machine_rows = db_retry(lambda: supabase.table('machines')\
            .select('id, line_id, lines!inner(line_number)')\
            .eq('is_active', True)\
            .execute())

        machine_ids_by_line = {1: [], 2: [], 3: []}
        for m in machine_rows.data or []:
            line_num = int(m.get('lines', {}).get('line_number') or 0)
            if line_num in machine_ids_by_line:
                machine_ids_by_line[line_num].append(m['id'])

        spm_last_10m = {'line_1': 0.0, 'line_2': 0.0, 'line_3': 0.0}
        for line_num in [1, 2, 3]:
            ids = machine_ids_by_line.get(line_num, [])
            if not ids:
                continue
            recent_strokes = db_retry(lambda: supabase.table('stroke_counts')\
                .select('id')\
                .in_('machine_id', ids)\
                .gte('reading_time', ten_min_ago)\
                .execute())
            stroke_events = len(recent_strokes.data or [])
            spm_last_10m[f'line_{line_num}'] = round(stroke_events / 10.0, 2)
        
        # Calculate uptime
        start = datetime.fromisoformat(system_status['start_time'])
        uptime_minutes = int((datetime.now() - start).total_seconds() / 60)
        
        # When PLC is disconnected, do not show stale running machine count.
        running_machines = sum(1 for state in previous_states.values() if state) if plc_connected else 0
        
        return jsonify({
            'success': True,
            'data': {
                'plc_connected': plc_connected,
                'last_read': system_status['last_plc_read'],
                'total_strokes': system_status['total_strokes'],
                'today_strokes': today_total,
                'shift_a': shift_totals['A'],
                'shift_b': shift_totals['B'],
                'shift_c': shift_totals['C'],
                'running_machines': running_machines,
                'total_machines': len(machines.data),
                'active_dies': len(active_dies.data),
                'open_tickets': len(open_tickets.data),
                'uptime': uptime_minutes,
                'spm_last_10m': spm_last_10m
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== MACHINE ROUTES ====================
@app.route('/api/machines', methods=['GET'])
@login_required
def get_machines():
    """Get all machines with current die info"""
    try:
        # Get all machines with line info
        machines = db_retry(lambda: supabase.table('machines')\
            .select('*, lines!inner(*)')\
            .eq('is_active', True)\
            .order('machine_number')\
            .execute())
        
        # Get today's production
        today = date.today().isoformat()
        production = db_retry(lambda: supabase.table('daily_production')\
            .select('machine_id, stroke_count')\
            .eq('production_date', today)\
            .execute())
        
        prod_dict = {}
        for p in production.data:
            if p['machine_id'] not in prod_dict:
                prod_dict[p['machine_id']] = 0
            prod_dict[p['machine_id']] += p['stroke_count']
        
        # Get active dies
        active_dies = db_retry(lambda: supabase.table('dies')\
            .select('id, die_code, model_id, position, current_machine_id, die_models!inner(model_code)')\
            .eq('status', 'In-Use')\
            .execute())
        
        die_by_machine = {}
        for d in active_dies.data:
            if d['current_machine_id']:
                die_by_machine[d['current_machine_id']] = {
                    'id': d['id'],
                    'die_code': d['die_code'],
                    'model': d['die_models']['model_code'],
                    'position': d['position']
                }
        
        result = []
        for machine in machines.data:
            machine_id = machine['id']
            die_info = die_by_machine.get(machine_id, {})
            
            running_state = previous_states.get(machine['plc_slave_id'] + 9, False) if plc_connected else False

            result.append({
                'id': machine_id,
                'name': machine['machine_name'],
                'machine_number': machine['machine_number'],
                'line_id': machine['line_id'],
                'line_number': machine['lines']['line_number'],
                'line_name': machine['lines']['line_name'],
                'plc_slave_id': machine['plc_slave_id'],
                'running': running_state,
                'die_id': die_info.get('id'),
                'die_code': die_info.get('die_code'),
                'die_model': die_info.get('model'),
                'die_position': die_info.get('position'),
                'today_strokes': prod_dict.get(machine_id, 0)
            })
        
        return jsonify({'success': True, 'data': result})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/machines/<int:machine_id>', methods=['GET'])
@login_required
def get_machine_detail(machine_id):
    """Get detailed machine info"""
    try:
        # Get machine
        machine = supabase.table('machines')\
            .select('*, lines!inner(*)')\
            .eq('id', machine_id)\
            .single()\
            .execute()
        
        # Get current die
        current_die = supabase.table('dies')\
            .select('*, die_models(*)')\
            .eq('current_machine_id', machine_id)\
            .eq('status', 'In-Use')\
            .execute()
        
        # Get today's production
        today = date.today().isoformat()
        production = supabase.table('daily_production')\
            .select('shift, stroke_count')\
            .eq('machine_id', machine_id)\
            .eq('production_date', today)\
            .execute()
        
        # Get stroke history (last 100)
        strokes = supabase.table('stroke_counts')\
            .select('reading_time, stroke_count')\
            .eq('machine_id', machine_id)\
            .order('reading_time', desc=True)\
            .limit(100)\
            .execute()
        
        return jsonify({
            'success': True,
            'data': {
                'machine': machine.data,
                'current_die': current_die.data[0] if current_die.data else None,
                'today_production': production.data,
                'stroke_history': strokes.data
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== DIE ROUTES ====================
@app.route('/api/dies', methods=['GET'])
@login_required
def get_dies():
    """Get all dies"""
    try:
        dies_result = db_retry(lambda: supabase.table('dies')\
            .select('*, die_models!left(*), machines!left(machine_name)')\
            .order('die_code')\
            .execute())

        dies_data = dies_result.data or []
        die_ids = [d.get('id') for d in dies_data if d.get('id') is not None]

        schedules_by_die = {}
        if die_ids:
            schedule_result = db_retry(lambda: supabase.table('die_check_schedule')\
                .select('*')\
                .in_('die_id', die_ids)\
                .execute())
            for sch in (schedule_result.data or []):
                schedules_by_die.setdefault(sch.get('die_id'), []).append(sch)

        for die in dies_data:
            die_id = die.get('id')
            die['schedules'] = schedules_by_die.get(die_id, [])

            model = die.get('die_models') or {}
            total_strokes = float(die.get('total_strokes') or 0)
            max_life = die.get('max_life_cycles') or model.get('expected_life_cycles') or 0

            if max_life and float(max_life) > 0:
                used_pct = (total_strokes / float(max_life)) * 100.0
                remaining_pct = max(0.0, 100.0 - used_pct)
            else:
                used_pct = 0.0
                remaining_pct = 100.0

            die['health_percentage'] = round(remaining_pct, 2)
            die['health_status'] = 'Good' if used_pct < 70 else 'Warning' if used_pct < 90 else 'Critical'
        
        return jsonify({'success': True, 'data': dies_data})
        
    except Exception as e:
        print(f"[API /api/dies ERROR] {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/die-models', methods=['GET'])
@login_required
def get_die_models():
    """Get all die models"""
    try:
        result = supabase.table('die_models')\
            .select('*')\
            .order('model_code')\
            .execute()
        return jsonify({'success': True, 'data': result.data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies/options', methods=['GET'])
@login_required
def get_die_options():
    """Lightweight die list for dropdowns and form options."""
    try:
        result = db_retry(lambda: supabase.table('dies')\
            .select('id, die_code, status')\
            .neq('status', 'Retired')\
            .order('die_code')\
            .execute())
        return jsonify({'success': True, 'data': result.data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies', methods=['POST'])
@login_required
@role_required('edit_dies')
def add_die():
    """Add new die"""
    try:
        data = request.json
        position_label = data.get('position', 'Upper')
        max_life_cycles = parse_optional_int(data.get('max_life_cycles'))
        position_word = 'UPPER' if str(position_label).lower().startswith('u') else 'LOWER'

        model_id = data.get('model_id')
        model_code = None
        model_number = str(data.get('model_number', '')).strip().upper()
        short_name = re.sub(r'[^A-Z0-9]', '', str(data.get('short_name', '')).upper())

        # New flow: create/find model from model details when model_id is not provided.
        if not model_id:
            model_name = str(data.get('model_name', '')).strip()
            if not model_name or not model_number or not short_name:
                return jsonify({
                    'success': False,
                    'error': 'model_name, model_number and short_name are required'
                }), 400

            model_code = f"{short_name}-{model_number}"
            existing_model = supabase.table('die_models')\
                .select('id, model_code')\
                .eq('model_code', model_code)\
                .limit(1)\
                .execute()

            if existing_model.data:
                model_id = existing_model.data[0]['id']
            else:
                expected_life_cycles = max_life_cycles or 1000000
                try:
                    created_model = supabase.table('die_models').insert({
                        'model_code': model_code,
                        'model_name': model_name,
                        'expected_life_cycles': expected_life_cycles
                    }).execute()
                    model_id = created_model.data[0]['id']
                except Exception as e:
                    err = str(e)
                    if "row-level security policy" in err.lower():
                        return jsonify({
                            'success': False,
                            'error': (
                                "Model create blocked by RLS. Add SUPABASE_SERVICE_ROLE_KEY "
                                "in backend/.env or pre-create this model in die_models table."
                            )
                        }), 403
                    raise
        else:
            model = supabase.table('die_models')\
                .select('model_code')\
                .eq('id', model_id)\
                .single()\
                .execute()
            model_code = model.data['model_code']
            if not short_name or not model_number:
                parts = str(model_code or '').upper().split('-')
                if len(parts) >= 2:
                    short_name = short_name or re.sub(r'[^A-Z0-9]', '', parts[0])
                    model_number = model_number or re.sub(r'[^A-Z0-9]', '', parts[1])

        if not short_name or not model_number:
            return jsonify({'success': False, 'error': 'Unable to generate die code'}), 400

        # Required format: SHORT-UPPER/LOWER-XX (e.g. YTA-UPPER-01)
        die_code = f"{short_name}-{position_word}-{model_number}"

        # Do not allow duplicate die code.
        existing_die = supabase.table('dies')\
            .select('id')\
            .eq('die_code', die_code)\
            .limit(1)\
            .execute()
        if existing_die.data:
            return jsonify({
                'success': False,
                'error': f'Die already exists with code: {die_code}'
            }), 409
        
        # Insert die
        result = supabase.table('dies').insert({
            'die_code': die_code,
            'model_id': model_id,
            'position': position_label,
            'status': 'Available',
            'total_strokes': 0,
            'pm_count': 0,
            'installation_date': data.get('installation_date'),
            'max_life_cycles': max_life_cycles
        }).execute()
        
        die_id = result.data[0]['id']

        # Optional document links from Add Die form.
        # These columns may not exist in all DB versions, so update is best-effort.
        doc_update = {}
        if data.get('tool_drawing_url'):
            doc_update['tool_drawing_url'] = data.get('tool_drawing_url')
        if data.get('die_layout_url'):
            doc_update['die_layout_url'] = data.get('die_layout_url')
        if data.get('maintenance_manual_url'):
            doc_update['maintenance_manual_url'] = data.get('maintenance_manual_url')
        photo_urls = data.get('photo_urls')
        if isinstance(photo_urls, list) and photo_urls:
            # Store as JSON string to support text/jsonb columns.
            doc_update['photo_urls'] = json.dumps(photo_urls)

        if doc_update:
            try:
                supabase.table('dies').update(doc_update).eq('id', die_id).execute()
            except Exception as _:
                # Ignore schema mismatch; die creation should not fail due to optional doc fields.
                pass
        
        # Initialize check schedules
        checks = supabase.table('pm_check_master')\
            .select('check_type, frequency_count')\
            .eq('is_active', True)\
            .execute()
        
        for check in checks.data:
            supabase.table('die_check_schedule').insert({
                'die_id': die_id,
                'check_type': check['check_type'],
                'next_due_count': check['frequency_count'],
                'status': 'ACTIVE'
            }).execute()
        
        # Log to history
        log_to_history(
            die_id=die_id,
            event_type='CREATE',
            description=f"New die created: {die_code}"
        )
        
        return jsonify({
            'success': True,
            'data': {
                'id': die_id,
                'die_code': die_code
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies/<int:die_id>', methods=['PUT'])
@login_required
@role_required('edit_dies')
def update_die(die_id):
    """Update die details"""
    try:
        data = request.json
        max_life_cycles = parse_optional_int(data.get('max_life_cycles'))
        
        # Update die
        supabase.table('dies').update({
            'die_code': data.get('die_code'),
            'model_id': data.get('model_id'),
            'position': data.get('position'),
            'max_life_cycles': max_life_cycles,
            'updated_at': datetime.now().isoformat()
        }).eq('id', die_id).execute()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies/<int:die_id>/load', methods=['POST'])
@login_required
@role_required('edit_die_config')
def load_die(die_id):
    """Load die to machine"""
    try:
        data = request.json
        machine_id = data.get('machine_id')
        
        if not machine_id:
            return jsonify({'success': False, 'error': 'Machine ID required'}), 400
        
        # Check if machine exists and is active
        machine = supabase.table('machines')\
            .select('*')\
            .eq('id', machine_id)\
            .eq('is_active', True)\
            .single()\
            .execute()
        
        # Check if any die is already loaded
        current = supabase.table('dies')\
            .select('id, die_code')\
            .eq('current_machine_id', machine_id)\
            .eq('status', 'In-Use')\
            .execute()
        
        if current.data:
            # Unload current die
            old_die = current.data[0]
            supabase.table('dies').update({
                'current_machine_id': None,
                'status': 'Available',
                'updated_at': datetime.now().isoformat()
            }).eq('id', old_die['id']).execute()
            
            # Record movement
            supabase.table('die_movements').insert({
                'die_id': old_die['id'],
                'from_machine_id': machine_id,
                'movement_type': 'UNLOAD',
                'performed_by': session['user']['username'],
                'created_at': datetime.now().isoformat()
            }).execute()
            
            # Log history
            log_to_history(
                die_id=old_die['id'],
                machine_id=machine_id,
                event_type='UNLOAD',
                description=f"Unloaded from {machine.data['machine_name']}"
            )
        
        # Load new die
        supabase.table('dies').update({
            'current_machine_id': machine_id,
            'status': 'In-Use',
            'updated_at': datetime.now().isoformat()
        }).eq('id', die_id).execute()
        
        # Get die total strokes
        die = supabase.table('dies')\
            .select('total_strokes')\
            .eq('id', die_id)\
            .single()\
            .execute()
        
        # Record movement
        supabase.table('die_movements').insert({
            'die_id': die_id,
            'to_machine_id': machine_id,
            'movement_type': 'LOAD',
            'strokes_at_movement': die.data['total_strokes'],
            'performed_by': session['user']['username'],
            'created_at': datetime.now().isoformat()
        }).execute()
        
        # Log history
        log_to_history(
            die_id=die_id,
            machine_id=machine_id,
            event_type='LOAD',
            description=f"Loaded to {machine.data['machine_name']}"
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies/<int:die_id>/unload', methods=['POST'])
@login_required
@role_required('edit_die_config')
def unload_die(die_id):
    """Unload die from machine"""
    try:
        # Get current machine
        die = supabase.table('dies')\
            .select('current_machine_id')\
            .eq('id', die_id)\
            .single()\
            .execute()
        
        machine_id = die.data['current_machine_id']
        
        if not machine_id:
            return jsonify({'success': False, 'error': 'Die not loaded on any machine'}), 400
        
        # Get machine name
        machine = supabase.table('machines')\
            .select('machine_name')\
            .eq('id', machine_id)\
            .single()\
            .execute()
        
        # Unload die
        supabase.table('dies').update({
            'current_machine_id': None,
            'status': 'Available',
            'updated_at': datetime.now().isoformat()
        }).eq('id', die_id).execute()
        
        # Record movement
        supabase.table('die_movements').insert({
            'die_id': die_id,
            'from_machine_id': machine_id,
            'movement_type': 'UNLOAD',
            'performed_by': session['user']['username'],
            'created_at': datetime.now().isoformat()
        }).execute()
        
        # Log history
        log_to_history(
            die_id=die_id,
            machine_id=machine_id,
            event_type='UNLOAD',
            description=f"Unloaded from {machine.data['machine_name']}"
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dies/<int:die_id>/history', methods=['GET'])
@login_required
def get_die_history(die_id):
    """Get complete die history"""
    try:
        # Get die details
        die = supabase.table('dies')\
            .select('*, die_models(*)')\
            .eq('id', die_id)\
            .single()\
            .execute()
        
        # Get movements
        movements = supabase.table('die_movements')\
            .select('*, from_machine:machines!from_machine_id(machine_name), to_machine:machines!to_machine_id(machine_name)')\
            .eq('die_id', die_id)\
            .order('created_at', desc=True)\
            .execute()
        
        # Get tickets
        tickets = supabase.table('tickets')\
            .select('*, machines(machine_name)')\
            .eq('die_id', die_id)\
            .order('created_at', desc=True)\
            .execute()

        # Get repair and quality records for all tickets of this die
        ticket_ids = [t['id'] for t in (tickets.data or []) if t.get('id') is not None]
        repairs_data = []
        quality_data = []
        if ticket_ids:
            repairs = supabase.table('repair_work')\
                .select('*')\
                .in_('ticket_id', ticket_ids)\
                .order('performed_at', desc=True)\
                .execute()
            repairs_data = repairs.data or []

            qualities = supabase.table('quality_checks')\
                .select('*')\
                .in_('ticket_id', ticket_ids)\
                .order('checked_at', desc=True)\
                .execute()
            quality_data = qualities.data or []

        repairs_by_ticket = {}
        for repair in repairs_data:
            repairs_by_ticket.setdefault(repair['ticket_id'], []).append(repair)

        quality_by_ticket = {}
        for quality in quality_data:
            quality_by_ticket.setdefault(quality['ticket_id'], []).append(quality)

        for ticket in (tickets.data or []):
            t_id = ticket.get('id')
            ticket['repairs'] = repairs_by_ticket.get(t_id, [])
            ticket['qualities'] = quality_by_ticket.get(t_id, [])
        
        # Get stroke history (last 1000)
        strokes = supabase.table('stroke_counts')\
            .select('*')\
            .eq('die_id', die_id)\
            .order('reading_time', desc=True)\
            .limit(1000)\
            .execute()
        
        # Get daily production
        daily = supabase.table('daily_production')\
            .select('*')\
            .eq('die_id', die_id)\
            .order('production_date', desc=True)\
            .limit(30)\
            .execute()
        
        # Get history log
        history = supabase.table('die_history')\
            .select('*')\
            .eq('die_id', die_id)\
            .order('created_at', desc=True)\
            .limit(500)\
            .execute()
        
        return jsonify({
            'success': True,
            'data': {
                'die': die.data,
                'movements': movements.data,
                'tickets': tickets.data,
                'repairs': repairs_data,
                'qualities': quality_data,
                'strokes': strokes.data,
                'daily': daily.data,
                'history': history.data
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== TICKET ROUTES ====================
@app.route('/api/tickets', methods=['GET'])
@login_required
def get_tickets():
    """Get all tickets with filters"""
    try:
        status = request.args.get('status', 'all')
        die_id = request.args.get('die_id')
        machine_id = request.args.get('machine_id')
        limit = request.args.get('limit')
        
        query = supabase.table('tickets')\
            .select('*, dies!inner(die_code, die_models!inner(model_code)), machines!left(machine_name)')
        
        if status != 'all':
            status_list = status.split(',')
            query = query.in_('status', status_list)
        
        if die_id:
            query = query.eq('die_id', die_id)
        
        if machine_id:
            query = query.eq('machine_id', machine_id)
        
        query = query.order('created_at', desc=True)
        
        if limit:
            query = query.limit(int(limit))
        
        result = db_retry(lambda: query.execute())
        
        return jsonify({'success': True, 'data': result.data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tickets/<int:ticket_id>', methods=['GET'])
@login_required
def get_ticket(ticket_id):
    """Get ticket with all details"""
    try:
        # Get ticket
        ticket = supabase.table('tickets')\
            .select('*, dies!inner(*, die_models!inner(*)), machines!left(*)')\
            .eq('id', ticket_id)\
            .single()\
            .execute()
        
        # Get repairs
        repairs = supabase.table('repair_work')\
            .select('*')\
            .eq('ticket_id', ticket_id)\
            .order('work_sequence')\
            .execute()
        
        # Get quality checks
        qualities = supabase.table('quality_checks')\
            .select('*')\
            .eq('ticket_id', ticket_id)\
            .order('check_sequence')\
            .execute()
        
        return jsonify({
            'success': True,
            'data': {
                'ticket': ticket.data,
                'repairs': repairs.data,
                'qualities': qualities.data
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tickets', methods=['POST'])
@login_required
@role_required('create_tickets')
def create_ticket():
    """Create manual ticket"""
    try:
        data = request.json
        
        # Generate ticket number
        ticket_number = f"MAN-{datetime.now().strftime('%Y%m%d')}-{secrets.randbelow(10000):04d}"
        
        # Get die info for machine_id
        die = supabase.table('dies')\
            .select('current_machine_id')\
            .eq('id', data['die_id'])\
            .single()\
            .execute()
        
        # Insert ticket
        result = supabase.table('tickets').insert({
            'ticket_number': ticket_number,
            'die_id': data['die_id'],
            'machine_id': die.data['current_machine_id'],
            'plan_type': data.get('plan_type'),
            'source': 'MANUAL',
            'title': data['title'],
            'description': data.get('description'),
            'priority': data.get('priority', 'MEDIUM'),
            'status': 'OPEN',
            'reported_by': session['user']['username'],
            'reported_at': datetime.now().isoformat()
        }).execute()
        
        # Log to history
        log_to_history(
            die_id=data['die_id'],
            event_type='TICKET',
            ticket_number=ticket_number,
            description=f"Manual ticket created: {data['title']}"
        )
        
        return jsonify({
            'success': True,
            'data': {
                'id': result.data[0]['id'],
                'ticket_number': ticket_number
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tickets/<int:ticket_id>/assign', methods=['POST'])
@login_required
@role_required('assign_tickets')
def assign_ticket(ticket_id):
    """Assign ticket to maintenance"""
    try:
        # Update ticket
        result = supabase.table('tickets').update({
            'assigned_to': session['user']['username'],
            'assigned_at': datetime.now().isoformat(),
            'status': 'IN_PROGRESS',
            'updated_at': datetime.now().isoformat()
        }).eq('id', ticket_id).eq('status', 'OPEN').execute()
        
        if not result.data:
            return jsonify({'success': False, 'error': 'Ticket not found or already assigned'}), 404
        
        # Get ticket for history
        ticket = supabase.table('tickets')\
            .select('die_id, ticket_number')\
            .eq('id', ticket_id)\
            .single()\
            .execute()
        
        # Log to history
        log_to_history(
            die_id=ticket.data['die_id'],
            event_type='ASSIGN',
            ticket_number=ticket.data['ticket_number'],
            description=f"Assigned to {session['user']['username']}"
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== SPARE MASTER ROUTES ====================
@app.route('/api/spares', methods=['GET'])
@login_required
def get_spares():
    """Get spare master list."""
    try:
        spares = load_spare_master()
        spares.sort(key=lambda item: (item.get('name') or '').upper())
        return jsonify({'success': True, 'data': spares})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/spares', methods=['POST'])
@login_required
@role_required('manage_checks')
def add_spare():
    """Add spare to spare master (admin)."""
    try:
        data = request.json or {}
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'Spare name is required'}), 400

        part_number = str(data.get('part_number') or '').strip()
        default_cost = parse_optional_float(data.get('default_cost'))
        if default_cost is not None and default_cost < 0:
            return jsonify({'success': False, 'error': 'Default cost cannot be negative'}), 400

        spares = load_spare_master()
        normalized_name = name.upper()
        normalized_part = part_number.upper()

        for spare in spares:
            existing_name = str(spare.get('name') or '').strip().upper()
            existing_part = str(spare.get('part_number') or '').strip().upper()
            if existing_name == normalized_name and (not normalized_part or existing_part == normalized_part):
                return jsonify({'success': False, 'error': 'Spare already exists in list'}), 409

        new_spare = {
            'id': f"SP-{datetime.now().strftime('%Y%m%d%H%M%S')}-{secrets.randbelow(1000):03d}",
            'name': name,
            'part_number': part_number or None,
            'default_cost': default_cost,
            'created_by': session['user']['username'],
            'created_at': datetime.now().isoformat()
        }

        spares.append(new_spare)
        save_spare_master(spares)

        return jsonify({'success': True, 'data': new_spare})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tool-costs', methods=['GET'])
@login_required
def get_tool_costs():
    """Get tool cost tracking rows for dashboard (admin + management)."""
    role = session.get('user', {}).get('role')
    if role not in ['admin', 'management']:
        return jsonify({'success': False, 'error': 'Permission denied'}), 403

    try:
        dies_result = db_retry(lambda: supabase.table('dies')\
            .select('id, die_code, total_strokes')\
            .order('die_code')\
            .execute())
        dies = dies_result.data or []
        die_ids = [d.get('id') for d in dies if d.get('id') is not None]
        base_costs = load_tool_costs()

        repair_cost_by_die = {str(did): 0.0 for did in die_ids}
        if die_ids:
            tickets = db_retry(lambda: supabase.table('tickets')\
                .select('id, die_id')\
                .in_('die_id', die_ids)\
                .execute())
            ticket_rows = tickets.data or []
            ticket_to_die = {t.get('id'): t.get('die_id') for t in ticket_rows if t.get('id') is not None}
            ticket_ids = [t.get('id') for t in ticket_rows if t.get('id') is not None]

            if ticket_ids:
                try:
                    repairs = db_retry(lambda: supabase.table('repair_work')\
                        .select('ticket_id, repair_cost')\
                        .in_('ticket_id', ticket_ids)\
                        .execute())
                    for r in (repairs.data or []):
                        die_id = ticket_to_die.get(r.get('ticket_id'))
                        if die_id is None:
                            continue
                        repair_cost_by_die[str(die_id)] = repair_cost_by_die.get(str(die_id), 0.0) + float(r.get('repair_cost') or 0)
                except Exception:
                    # Older DB schema may not have repair_cost column.
                    pass

        rows = []
        for die in dies:
            die_id = die.get('id')
            production = int(die.get('total_strokes') or 0)
            base_cost = float(base_costs.get(str(die_id), 0.0))
            repair_cost = float(repair_cost_by_die.get(str(die_id), 0.0))
            total_cost = base_cost + repair_cost
            cost_per_part = (total_cost / production) if production > 0 else 0.0

            rows.append({
                'die_id': die_id,
                'tool_code': die.get('die_code') or '-',
                'production': production,
                'base_cost': round(base_cost, 2),
                'repair_cost': round(repair_cost, 2),
                'total_cost': round(total_cost, 2),
                'cost_per_part': round(cost_per_part, 4)
            })

        return jsonify({'success': True, 'data': rows})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tool-costs/<int:die_id>', methods=['PUT'])
@login_required
@role_required('edit_dies')
def update_tool_cost(die_id):
    """Update base tool cost for a die (admin)."""
    try:
        data = request.json or {}
        base_cost = parse_optional_float(data.get('base_cost'))
        if base_cost is None or base_cost < 0:
            return jsonify({'success': False, 'error': 'Valid base_cost is required'}), 400

        die_check = db_retry(lambda: supabase.table('dies')\
            .select('id')\
            .eq('id', die_id)\
            .limit(1)\
            .execute())
        if not die_check.data:
            return jsonify({'success': False, 'error': 'Die not found'}), 404

        cost_map = load_tool_costs()
        cost_map[str(die_id)] = round(base_cost, 2)
        save_tool_costs(cost_map)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== REPAIR WORKFLOW ROUTES ====================
@app.route('/api/repairs/<int:ticket_id>/work', methods=['POST'])
@login_required
@role_required('do_repair')
def add_repair_work(ticket_id):
    """Add repair work"""
    try:
        data = request.json or {}
        
        # Get current work sequence
        ticket = supabase.table('tickets')\
            .select('current_work_sequence, die_id, ticket_number')\
            .eq('id', ticket_id)\
            .single()\
            .execute()
        
        current_sequence = ticket.data['current_work_sequence'] + 1
        
        selected_spare_id = str(data.get('spare_id') or '').strip()
        manual_spare = str(data.get('spare_manual') or '').strip()
        legacy_spare = str(data.get('spare_parts_used') or '').strip()
        selected_spare = None
        if selected_spare_id:
            selected_spare = next(
                (s for s in load_spare_master() if str(s.get('id')) == selected_spare_id),
                None
            )

        spare_label_parts = []
        if selected_spare:
            spare_name = str(selected_spare.get('name') or '').strip()
            part_no = str(selected_spare.get('part_number') or '').strip()
            if spare_name:
                spare_label_parts.append(f"{spare_name} [{part_no}]" if part_no else spare_name)
        if manual_spare:
            spare_label_parts.append(manual_spare)
        if legacy_spare:
            spare_label_parts.append(legacy_spare)

        spare_parts_used = ', '.join(dict.fromkeys([p for p in spare_label_parts if p]))

        spare_cost = parse_optional_float(data.get('spare_cost'))
        if spare_cost is None and selected_spare:
            spare_cost = parse_optional_float(selected_spare.get('default_cost'))
        if spare_cost is not None and spare_cost < 0:
            return jsonify({'success': False, 'error': 'Spare cost cannot be negative'}), 400

        insert_payload = {
            'ticket_id': ticket_id,
            'work_sequence': current_sequence,
            'root_cause': data.get('root_cause'),
            'action_taken': data.get('action_taken'),
            'spare_parts_used': spare_parts_used or None,
            'downtime_minutes': data.get('downtime_minutes', 0),
            'before_repair_image': data.get('before_image'),
            'after_repair_image': data.get('after_image'),
            'performed_by': session['user']['username'],
            'performed_at': datetime.now().isoformat()
        }
        if spare_cost is not None:
            insert_payload['repair_cost'] = spare_cost

        # Insert repair work (fallback if old schema has no repair_cost column)
        try:
            work = supabase.table('repair_work').insert(insert_payload).execute()
        except Exception as err:
            err_text = str(err).lower()
            if 'repair_cost' in err_text:
                insert_payload.pop('repair_cost', None)
                if spare_cost is not None:
                    existing_spare = insert_payload.get('spare_parts_used') or ''
                    cost_tag = f"Cost: {spare_cost:.2f}"
                    insert_payload['spare_parts_used'] = f"{existing_spare} | {cost_tag}" if existing_spare else cost_tag
                work = supabase.table('repair_work').insert(insert_payload).execute()
            else:
                raise
        
        # Update ticket status
        supabase.table('tickets').update({
            'status': 'QUALITY_CHECK',
            'current_work_sequence': current_sequence,
            'updated_at': datetime.now().isoformat()
        }).eq('id', ticket_id).execute()
        
        # Log to history
        log_to_history(
            die_id=ticket.data['die_id'],
            event_type='REPAIR',
            ticket_number=ticket.data['ticket_number'],
            description=f"Repair work #{current_sequence} completed"
        )
        
        return jsonify({
            'success': True,
            'data': {
                'work_id': work.data[0]['id'],
                'sequence': current_sequence
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/repairs/<int:ticket_id>/quality', methods=['POST'])
@login_required
@role_required('quality_check')
def quality_check(ticket_id):
    """Quality check with OK/NG"""
    try:
        def with_retry(operation, retries=3, delay=0.2):
            """Retry transient socket/network errors from Supabase client."""
            last_error = None
            for attempt in range(retries):
                try:
                    return operation()
                except Exception as err:
                    last_error = err
                    msg = str(err)
                    transient = (
                        '10035' in msg or
                        'timed out' in msg.lower() or
                        'connection' in msg.lower() or
                        'socket' in msg.lower()
                    )
                    if not transient or attempt == retries - 1:
                        raise
                    time.sleep(delay * (attempt + 1))
            raise last_error

        data = request.json
        result = data.get('result')  # OK or NG
        
        # Get ticket details
        ticket = with_retry(lambda: supabase.table('tickets')\
            .select('*, dies!inner(*)')\
            .eq('id', ticket_id)\
            .single()\
            .execute())
        
        current_sequence = ticket.data['current_work_sequence']
        
        # Get latest repair work
        work = with_retry(lambda: supabase.table('repair_work')\
            .select('id')\
            .eq('ticket_id', ticket_id)\
            .eq('work_sequence', current_sequence)\
            .single()\
            .execute())
        
        # Insert quality check
        quality = with_retry(lambda: supabase.table('quality_checks').insert({
            'ticket_id': ticket_id,
            'work_id': work.data['id'],
            'check_sequence': current_sequence,
            'result': result,
            'comments': data.get('comments'),
            'rework_reason': data.get('rework_reason') if result == 'NG' else None,
            'checked_by': session['user']['username'],
            'checked_at': datetime.now().isoformat()
        }).execute())
        
        # Update ticket status
        new_status = 'REWORK' if result == 'NG' else 'CLOSED'
        with_retry(lambda: supabase.table('tickets').update({
            'status': new_status,
            'updated_at': datetime.now().isoformat()
        }).eq('id', ticket_id).execute())

        # PM count increases when any ticket is successfully closed by Quality OK (manual or auto).
        if result == 'OK' and ticket.data.get('status') != 'CLOSED':
            current_pm = ticket.data['dies'].get('pm_count') or 0
            with_retry(lambda: supabase.table('dies').update({
                'pm_count': current_pm + 1,
                'updated_at': datetime.now().isoformat()
            }).eq('id', ticket.data['dies']['id']).execute())
        
        # Log to history
        description = f"Quality {'OK - Closed' if result == 'OK' else f'NG - Rework required: ' + data.get('rework_reason', '')}"
        log_to_history(
            die_id=ticket.data['dies']['id'],
            event_type='QUALITY',
            ticket_number=ticket.data['ticket_number'],
            description=description
        )
        
        return jsonify({
            'success': True,
            'data': {
                'quality_id': quality.data[0]['id'],
                'new_status': new_status
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== CHECK MANAGEMENT ROUTES ====================
@app.route('/api/checks', methods=['GET'])
@login_required
def get_checks():
    """Get all A/B/C checks"""
    try:
        checks = supabase.table('pm_check_master')\
            .select('*')\
            .order('frequency_count')\
            .execute()
        
        return jsonify({'success': True, 'data': checks.data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/checks/<check_type>', methods=['PUT'])
@login_required
@role_required('manage_checks')
def update_check(check_type):
    """Update check frequency"""
    try:
        data = request.json
        check_type = str(check_type).upper().strip()
        if check_type not in ('A', 'B', 'C'):
            return jsonify({'success': False, 'error': 'Invalid check type'}), 400

        try:
            frequency = int(data.get('frequency_count'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Frequency must be a number'}), 400

        if frequency < 1000:
            return jsonify({'success': False, 'error': 'Frequency must be at least 1000'}), 400
        
        # Update master
        master_update = supabase.table('pm_check_master').update({
            'frequency_count': frequency,
            'updated_at': datetime.now().isoformat()
        }).eq('check_type', check_type).execute()

        # If row does not exist yet, create it.
        if not master_update.data:
            supabase.table('pm_check_master').upsert({
                'check_type': check_type,
                'check_name': f'{check_type} Check',
                'description': f'{check_type} check frequency configuration',
                'frequency_count': frequency,
                'is_active': True,
                'updated_at': datetime.now().isoformat()
            }, on_conflict='check_type').execute()
        
        # Update all active schedules
        supabase.table('die_check_schedule').update({
            'next_due_count': frequency
        }).eq('check_type', check_type).eq('status', 'ACTIVE').execute()
        
        # Log to history
        log_to_history(
            die_id=None,
            event_type='SYSTEM',
            description=f"{check_type} check frequency updated to {frequency}"
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/checks/reset', methods=['POST'])
@login_required
@role_required('manage_checks')
def reset_checks():
    """Reset all checks to default"""
    try:
        defaults = {
            'A': 50000,
            'B': 100000,
            'C': 200000
        }
        
        for check_type, frequency in defaults.items():
            # Update master
            master_update = supabase.table('pm_check_master').update({
                'frequency_count': frequency,
                'updated_at': datetime.now().isoformat()
            }).eq('check_type', check_type).execute()

            if not master_update.data:
                supabase.table('pm_check_master').upsert({
                    'check_type': check_type,
                    'check_name': f'{check_type} Check',
                    'description': f'{check_type} check frequency configuration',
                    'frequency_count': frequency,
                    'is_active': True,
                    'updated_at': datetime.now().isoformat()
                }, on_conflict='check_type').execute()
            
            # Update schedules
            supabase.table('die_check_schedule').update({
                'next_due_count': frequency
            }).eq('check_type', check_type).eq('status', 'ACTIVE').execute()
        
        # Log to history
        log_to_history(
            die_id=None,
            event_type='SYSTEM',
            description="All check frequencies reset to default"
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== USER MANAGEMENT ROUTES ====================
@app.route('/api/users', methods=['GET'])
@login_required
@role_required('manage_users')
def get_users():
    """Get all users"""
    try:
        users = supabase.table('users')\
            .select('id, username, full_name, role, is_active, created_at')\
            .order('username')\
            .execute()
        
        return jsonify({'success': True, 'data': users.data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users', methods=['POST'])
@login_required
@role_required('manage_users')
def add_user():
    """Add new user"""
    try:
        data = request.json
        role = str(data.get('role', '')).strip().lower()
        if role not in ALLOWED_ROLES:
            return jsonify({'success': False, 'error': f'Invalid role. Allowed: {", ".join(sorted(ALLOWED_ROLES))}'}), 400
        
        # Check if username exists
        existing = supabase.table('users')\
            .select('id')\
            .eq('username', data['username'])\
            .execute()
        
        if existing.data:
            return jsonify({'success': False, 'error': 'Username already exists'}), 400
        
        # Insert user
        result = supabase.table('users').insert({
            'username': data['username'],
            'password_hash': hash_password(data['password']),
            'full_name': data.get('full_name'),
            'role': role,
            'is_active': True
        }).execute()
        
        return jsonify({'success': True, 'data': {'id': result.data[0]['id']}})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@login_required
@role_required('manage_users')
def update_user(user_id):
    """Update user"""
    try:
        data = request.json
        update_data = {}
        
        if data.get('full_name'):
            update_data['full_name'] = data['full_name']
        
        if data.get('role'):
            role = str(data.get('role', '')).strip().lower()
            if role not in ALLOWED_ROLES:
                return jsonify({'success': False, 'error': f'Invalid role. Allowed: {", ".join(sorted(ALLOWED_ROLES))}'}), 400
            update_data['role'] = role
        
        if data.get('is_active') is not None:
            update_data['is_active'] = data['is_active']
        
        if data.get('password'):
            update_data['password_hash'] = hash_password(data['password'])
        
        if update_data:
            update_data['updated_at'] = datetime.now().isoformat()
            supabase.table('users').update(update_data).eq('id', user_id).execute()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== IMAGE UPLOAD ROUTES ====================
@app.route('/api/upload', methods=['POST'])
@login_required
def upload_image():
    """Upload repair image"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No image uploaded'}), 400
        
        file = request.files['image']
        ticket_id = request.form.get('ticket_id')
        image_type = request.form.get('type', 'repair')
        
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        # Generate unique filename
        ext = file.filename.split('.')[-1]
        filename = f"{image_type}_{ticket_id}_{secrets.token_hex(8)}.{ext}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        # Save file
        file.save(filepath)
        
        return jsonify({
            'success': True,
            'data': {
                'filename': filename,
                'url': f"{request.host_url.rstrip('/')}/api/images/{filename}"
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/images/<filename>', methods=['GET'])
def get_image(filename):
    """Get uploaded image"""
    try:
        return send_file(os.path.join(UPLOAD_FOLDER, filename))
    except:
        return jsonify({'success': False, 'error': 'Image not found'}), 404

# ==================== PRODUCTION ROUTES ====================
HOURLY_PLAN_CONFIG_PATH = Path(__file__).resolve().parent / 'hourly_plan_config.json'
DEFAULT_HOURLY_PLAN_CONFIG = {
    'spm': {'line_1': 10.0, 'line_2': 10.0, 'line_3': 10.0},
    'breaks': [],
    'line_machine_numbers': {'line_1': 9, 'line_2': 18, 'line_3': 27}
}

def _parse_hhmm(hhmm):
    text = str(hhmm or '').strip()
    if not re.match(r'^\d{2}:\d{2}$', text):
        raise ValueError(f'Invalid time format: {hhmm}')
    hh, mm = map(int, text.split(':'))
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        raise ValueError(f'Invalid time value: {hhmm}')
    return hh, mm

def _parse_iso_datetime(value):
    if not value:
        return None
    text = str(value).replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None

def _load_hourly_plan_config():
    try:
        if HOURLY_PLAN_CONFIG_PATH.exists():
            with open(HOURLY_PLAN_CONFIG_PATH, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            cfg = DEFAULT_HOURLY_PLAN_CONFIG.copy()
            cfg['spm'] = {**DEFAULT_HOURLY_PLAN_CONFIG['spm'], **(raw.get('spm') or {})}
            cfg['breaks'] = raw.get('breaks') or []
            cfg['line_machine_numbers'] = {
                **DEFAULT_HOURLY_PLAN_CONFIG['line_machine_numbers'],
                **(raw.get('line_machine_numbers') or {})
            }
            return cfg
    except Exception as e:
        print(f"[HOURLY PLAN] Failed to load config: {e}")
    return json.loads(json.dumps(DEFAULT_HOURLY_PLAN_CONFIG))

def _save_hourly_plan_config(config_data):
    with open(HOURLY_PLAN_CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config_data, f, indent=2)

def _overlap_seconds(start_a, end_a, start_b, end_b):
    latest_start = max(start_a, start_b)
    earliest_end = min(end_a, end_b)
    if earliest_end <= latest_start:
        return 0.0
    return (earliest_end - latest_start).total_seconds()

def _effective_minutes(slot_start, slot_end, breaks):
    total_seconds = max(0.0, (slot_end - slot_start).total_seconds())
    if total_seconds <= 0:
        return 0.0

    base_day = slot_start.date()
    subtract_seconds = 0.0
    for b in breaks:
        try:
            sh, sm = _parse_hhmm(b.get('start'))
            eh, em = _parse_hhmm(b.get('end'))
        except Exception:
            continue

        start_1 = datetime.combine(base_day, datetime.min.time()).replace(hour=sh, minute=sm)
        end_1 = datetime.combine(base_day, datetime.min.time()).replace(hour=eh, minute=em)
        if end_1 <= start_1:
            end_1 += timedelta(days=1)

        start_2 = start_1 + timedelta(days=1)
        end_2 = end_1 + timedelta(days=1)

        subtract_seconds += _overlap_seconds(slot_start, slot_end, start_1, end_1)
        subtract_seconds += _overlap_seconds(slot_start, slot_end, start_2, end_2)

    effective_seconds = max(0.0, total_seconds - subtract_seconds)
    return effective_seconds / 60.0

def _is_in_break(ts, breaks):
    """Return True if timestamp falls inside any configured break window."""
    if not breaks:
        return False
    base_day = ts.date()
    for b in breaks:
        try:
            sh, sm = _parse_hhmm(b.get('start'))
            eh, em = _parse_hhmm(b.get('end'))
        except Exception:
            continue

        start_1 = datetime.combine(base_day, datetime.min.time()).replace(hour=sh, minute=sm)
        end_1 = datetime.combine(base_day, datetime.min.time()).replace(hour=eh, minute=em)
        if end_1 <= start_1:
            end_1 += timedelta(days=1)

        start_2 = start_1 - timedelta(days=1)
        end_2 = end_1 - timedelta(days=1)

        if start_1 <= ts < end_1:
            return True
        if start_2 <= ts < end_2:
            return True
    return False

def _build_hourly_slots(for_date):
    base_start = datetime.combine(for_date, datetime.min.time()).replace(hour=8, minute=30, second=0, microsecond=0)
    slots = []
    for i in range(24):
        start = base_start + timedelta(hours=i)
        end = start + timedelta(hours=1)
        end_inclusive = end - timedelta(seconds=1)
        slots.append({
            'index': i + 1,
            'start': start,
            'end': end,
            'end_inclusive': end_inclusive,
            'label': f"{start.strftime('%H:%M:%S')} to {end_inclusive.strftime('%H:%M:%S')}"
        })
    return slots

def _resolve_line_key(machine_row):
    """Map machine row to line_1/line_2/line_3 with schema-safe fallbacks."""
    lines_obj = machine_row.get('lines')
    if isinstance(lines_obj, dict):
        line_number = int(lines_obj.get('line_number') or 0)
        if line_number in (1, 2, 3):
            return f'line_{line_number}'

    line_id = machine_row.get('line_id')
    if line_id in (1, 2, 3):
        return f'line_{line_id}'

    machine_number = int(machine_row.get('machine_number') or 0)
    if 1 <= machine_number <= 9:
        return 'line_1'
    if 10 <= machine_number <= 18:
        return 'line_2'
    if 19 <= machine_number <= 27:
        return 'line_3'
    return None

def _extract_machine_name_number(machine_name):
    if not machine_name:
        return None
    match = re.search(r'(\d+)', str(machine_name))
    if not match:
        return None
    return int(match.group(1))

def _resolve_machine_id_for_line(configured_number, line_key, machine_rows):
    """
    Resolve machine id for a line using robust matching.
    Priority:
    1) same line + machine_number == configured_number
    2) same line + machine_name contains configured_number (e.g. Press-18)
    """
    line_rows = [m for m in machine_rows if _resolve_line_key(m) == line_key]
    if not line_rows:
        return None

    for m in line_rows:
        try:
            if int(m.get('machine_number') or 0) == int(configured_number):
                return m.get('id')
        except Exception:
            pass

    for m in line_rows:
        name_num = _extract_machine_name_number(m.get('machine_name'))
        if name_num is not None and int(name_num) == int(configured_number):
            return m.get('id')

    return None

@app.route('/api/production/range', methods=['GET'])
@login_required
def get_production_range():
    """Get production for date range"""
    try:
        start_date = request.args.get('start')
        end_date = request.args.get('end')
        
        if not start_date or not end_date:
            return jsonify({'success': False, 'error': 'Start and end dates required'}), 400
        
        result = supabase.table('daily_production')\
            .select('*')\
            .gte('production_date', start_date)\
            .lte('production_date', end_date)\
            .order('production_date')\
            .execute()
        
        return jsonify({'success': True, 'data': result.data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hourly-plan/config', methods=['GET'])
@login_required
def get_hourly_plan_config():
    role = session.get('user', {}).get('role')
    if role not in ['production', 'admin']:
        return jsonify({'success': False, 'error': 'Permission denied'}), 403
    return jsonify({'success': True, 'data': _load_hourly_plan_config()})

@app.route('/api/hourly-plan/config', methods=['PUT'])
@login_required
@role_required('manage_checks')
def update_hourly_plan_config():
    try:
        data = request.json or {}
        spm = data.get('spm') or {}
        breaks = data.get('breaks') or []
        line_machine_numbers = data.get('line_machine_numbers') or {}

        normalized_spm = {}
        for line_key in ['line_1', 'line_2', 'line_3']:
            value = float(spm.get(line_key, DEFAULT_HOURLY_PLAN_CONFIG['spm'][line_key]))
            if value < 0:
                return jsonify({'success': False, 'error': f'SPM for {line_key} must be >= 0'}), 400
            normalized_spm[line_key] = value

        normalized_breaks = []
        for b in breaks:
            start = b.get('start')
            end = b.get('end')
            _parse_hhmm(start)
            _parse_hhmm(end)
            normalized_breaks.append({'start': start, 'end': end})

        normalized_machine_numbers = {}
        for line_key in ['line_1', 'line_2', 'line_3']:
            machine_number = int(line_machine_numbers.get(line_key, DEFAULT_HOURLY_PLAN_CONFIG['line_machine_numbers'][line_key]))
            normalized_machine_numbers[line_key] = machine_number

        new_config = {
            'spm': normalized_spm,
            'breaks': normalized_breaks,
            'line_machine_numbers': normalized_machine_numbers
        }
        _save_hourly_plan_config(new_config)
        return jsonify({'success': True, 'data': new_config})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/hourly-plan', methods=['GET'])
@login_required
def get_hourly_plan():
    role = session.get('user', {}).get('role')
    if role not in ['production', 'admin']:
        return jsonify({'success': False, 'error': 'Permission denied'}), 403

    try:
        date_param = request.args.get('date')
        target_date = datetime.strptime(date_param, '%Y-%m-%d').date() if date_param else date.today()
        now = datetime.now()
        config = _load_hourly_plan_config()
        slots = _build_hourly_slots(target_date)
        window_start = slots[0]['start']
        window_end = slots[-1]['end']
        ten_min_ago = now - timedelta(minutes=10)

        machines = db_retry(lambda: supabase.table('machines')\
            .select('id, machine_number, machine_name, line_id, lines(line_number)')\
            .eq('is_active', True)\
            .execute())
        machine_rows = machines.data or []
        line_all_machine_ids = {'line_1': [], 'line_2': [], 'line_3': []}
        for m in machine_rows:
            line_key = _resolve_line_key(m)
            if line_key:
                line_all_machine_ids[line_key].append(m.get('id'))

        line_machine_ids = {}
        for line_key in ['line_1', 'line_2', 'line_3']:
            machine_number = int(config.get('line_machine_numbers', {}).get(line_key, 0))
            line_machine_ids[line_key] = _resolve_machine_id_for_line(machine_number, line_key, machine_rows)

        all_machine_ids = set()
        for mid in line_machine_ids.values():
            if mid is not None:
                all_machine_ids.add(mid)
        for ids in line_all_machine_ids.values():
            for mid in ids:
                if mid is not None:
                    all_machine_ids.add(mid)

        stroke_rows = []
        if all_machine_ids:
            strokes = db_retry(lambda: supabase.table('stroke_counts')\
                .select('machine_id, reading_time')\
                .in_('machine_id', list(all_machine_ids))\
                .gte('reading_time', window_start.isoformat())\
                .lt('reading_time', window_end.isoformat())\
                .execute())
            stroke_rows = strokes.data or []

        per_line_times_cfg = {'line_1': [], 'line_2': [], 'line_3': []}
        per_line_times_all = {'line_1': [], 'line_2': [], 'line_3': []}
        breaks = config.get('breaks') or []
        for row in stroke_rows:
            mid = row.get('machine_id')
            reading_time = _parse_iso_datetime(row.get('reading_time'))
            if not reading_time:
                continue
            if reading_time.tzinfo is not None:
                reading_time = reading_time.astimezone().replace(tzinfo=None)
            # Break window strokes should not be counted in hourly actual.
            if _is_in_break(reading_time, breaks):
                continue

            for line_key, ids in line_all_machine_ids.items():
                if mid in ids:
                    per_line_times_all[line_key].append(reading_time)
                    break

            for line_key, machine_id in line_machine_ids.items():
                if machine_id == mid:
                    per_line_times_cfg[line_key].append(reading_time)
                    break

        for line_key in per_line_times_cfg:
            per_line_times_cfg[line_key].sort()
            per_line_times_all[line_key].sort()

        # Stable bucketized actual counts per 1-hour slot.
        # This avoids any cross-slot drift while current hour is increasing.
        slot_count = len(slots)
        actual_bucket_cfg = {k: [0] * slot_count for k in ['line_1', 'line_2', 'line_3']}
        actual_bucket_all = {k: [0] * slot_count for k in ['line_1', 'line_2', 'line_3']}

        def _slot_index(ts):
            delta_sec = (ts - window_start).total_seconds()
            idx = int(delta_sec // 3600)
            return idx if 0 <= idx < slot_count else None

        for line_key in ['line_1', 'line_2', 'line_3']:
            for ts in per_line_times_cfg[line_key]:
                idx = _slot_index(ts)
                if idx is not None:
                    actual_bucket_cfg[line_key][idx] += 1
            for ts in per_line_times_all[line_key]:
                idx = _slot_index(ts)
                if idx is not None:
                    actual_bucket_all[line_key][idx] += 1

        cumulative_plan = {'line_1': 0, 'line_2': 0, 'line_3': 0}
        cumulative_actual = {'line_1': 0, 'line_2': 0, 'line_3': 0}
        rows = []
        spm_cfg = config.get('spm') or {}
        kpi = {}

        line_use_cfg = {}
        for line_key in ['line_1', 'line_2', 'line_3']:
            # Keep one stable source per line to prevent hour-wise value flips.
            # If configured machine exists, always use that (admin authority).
            # Fallback to full line only when configured machine is not mapped.
            has_cfg_machine = line_machine_ids.get(line_key) is not None
            line_use_cfg[line_key] = bool(has_cfg_machine)
            recent_cfg = sum(1 for ts in per_line_times_cfg[line_key] if ten_min_ago <= ts <= now)
            recent_all = sum(1 for ts in per_line_times_all[line_key] if ten_min_ago <= ts <= now)
            recent_actual = recent_cfg if line_use_cfg[line_key] else recent_all
            kpi[line_key] = {
                'plan_spm': float(spm_cfg.get(line_key, 0) or 0),
                'actual_last_10m_strokes': recent_actual,
                'actual_last_10m_spm': round(recent_actual / 10.0, 1),
                'machine_number': int(config.get('line_machine_numbers', {}).get(line_key, 0) or 0)
            }

        for slot_idx, slot in enumerate(slots):
            start = slot['start']
            end = slot['end']
            row = {
                'slot': slot['label'],
                'start': start.isoformat(),
                'end': end.isoformat(),
                'lines': {},
                'totals': {}
            }
            total_plan = 0
            total_actual = 0

            for line_key in ['line_1', 'line_2', 'line_3']:
                spm = float(spm_cfg.get(line_key, 0) or 0)
                full_effective = _effective_minutes(start, end, breaks)
                planned = int(round(spm * full_effective))

                elapsed_end = min(now, end)
                elapsed_plan = 0
                if elapsed_end > start:
                    elapsed_effective = _effective_minutes(start, elapsed_end, breaks)
                    elapsed_plan = int(round(spm * elapsed_effective))

                actual_cfg = actual_bucket_cfg[line_key][slot_idx]
                actual_all = actual_bucket_all[line_key][slot_idx]
                actual = actual_cfg if line_use_cfg[line_key] else actual_all

                cumulative_plan[line_key] += planned
                cumulative_actual[line_key] += actual
                total_plan += planned
                total_actual += actual

                row['lines'][line_key] = {
                    'spm': spm,
                    'planned': planned,
                    'elapsed_planned': elapsed_plan,
                    'actual': actual,
                    'actual_source': 'configured_machine' if line_use_cfg[line_key] else 'line_fallback',
                    'cumulative_planned': cumulative_plan[line_key],
                    'cumulative_actual': cumulative_actual[line_key]
                }

            row['totals'] = {
                'planned': total_plan,
                'actual': total_actual
            }
            rows.append(row)

        return jsonify({
            'success': True,
            'data': {
                'date': target_date.isoformat(),
                'config': config,
                'kpi': kpi,
                'rows': rows
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/pm/pending', methods=['GET'])
@login_required
def get_pending_pm():
    """Get all pending/overdue PM checks with die and location details."""
    try:
        schedules = db_retry(lambda: supabase.table('die_check_schedule')\
            .select('id, die_id, check_type, next_due_count, status')\
            .eq('status', 'ACTIVE')\
            .execute())

        dies = db_retry(lambda: supabase.table('dies')\
            .select('id, die_code, model_id, total_strokes, current_machine_id')\
            .execute())

        machines = db_retry(lambda: supabase.table('machines')\
            .select('id, machine_name')\
            .eq('is_active', True)\
            .execute())

        models = db_retry(lambda: supabase.table('die_models')\
            .select('id, model_code')\
            .execute())

        die_map = {d['id']: d for d in (dies.data or [])}
        machine_map = {m['id']: m.get('machine_name') for m in (machines.data or [])}
        model_map = {m['id']: m.get('model_code') for m in (models.data or [])}

        pending = []
        for s in schedules.data or []:
            die = die_map.get(s.get('die_id'))
            if not die:
                continue
            total = int(die.get('total_strokes') or 0)
            due = int(s.get('next_due_count') or 0)
            if total < due:
                continue

            overdue_by = total - due
            pending.append({
                'schedule_id': s.get('id'),
                'die_id': die.get('id'),
                'die_code': die.get('die_code'),
                'model_code': model_map.get(die.get('model_id')) or '-',
                'check_type': s.get('check_type'),
                'next_due_count': due,
                'current_strokes': total,
                'overdue_by': overdue_by,
                'current_location': machine_map.get(die.get('current_machine_id')) or 'Store'
            })

        pending.sort(key=lambda x: (x['overdue_by'], x['die_code']), reverse=True)
        return jsonify({'success': True, 'data': pending})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/management/overview', methods=['GET'])
@login_required
def get_management_overview():
    """Management dashboard KPIs and chart data."""
    role = session.get('user', {}).get('role')
    if role not in ['management', 'admin']:
        return jsonify({'success': False, 'error': 'Permission denied'}), 403

    try:
        now_dt = datetime.now()
        current_month_start = now_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        six_month_window = (current_month_start - timedelta(days=155)).isoformat()

        dies_result = db_retry(lambda: supabase.table('dies')\
            .select('id, die_code, status, total_strokes, max_life_cycles, die_models(expected_life_cycles)')\
            .execute())
        dies = dies_result.data or []

        total_tools = len(dies)
        tools_in_production = sum(1 for d in dies if d.get('status') == 'In-Use')
        tools_in_maintenance = sum(1 for d in dies if d.get('status') == 'Maintenance')

        tools_near_breakdown = 0
        for d in dies:
            total = float(d.get('total_strokes') or 0)
            model = d.get('die_models') or {}
            life = d.get('max_life_cycles') or model.get('expected_life_cycles') or 0
            if life and float(life) > 0:
                used_pct = (total / float(life)) * 100.0
                if used_pct >= 90.0:
                    tools_near_breakdown += 1

        schedules = db_retry(lambda: supabase.table('die_check_schedule')\
            .select('die_id, next_due_count, status')\
            .eq('status', 'ACTIVE')\
            .execute())
        die_strokes = {d.get('id'): int(d.get('total_strokes') or 0) for d in dies}
        maintenance_due_today = 0
        for s in (schedules.data or []):
            did = s.get('die_id')
            due = int(s.get('next_due_count') or 0)
            curr = die_strokes.get(did, 0)
            if curr >= due:
                maintenance_due_today += 1

        # Monthly maintenance cost (last 6 months)
        monthly_map = {}
        for i in range(6):
            m = (current_month_start - timedelta(days=30 * (5 - i))).replace(day=1)
            key = m.strftime('%Y-%m')
            monthly_map[key] = 0.0

        repair_rows = []
        try:
            repairs = db_retry(lambda: supabase.table('repair_work')\
                .select('performed_at, repair_cost')\
                .gte('performed_at', six_month_window)\
                .execute())
            repair_rows = repairs.data or []
        except Exception:
            # Fallback when repair_cost column does not exist in older schema.
            repairs = db_retry(lambda: supabase.table('repair_work')\
                .select('performed_at')\
                .gte('performed_at', six_month_window)\
                .execute())
            repair_rows = repairs.data or []

        for r in repair_rows:
            p = _parse_iso_datetime(r.get('performed_at'))
            if not p:
                continue
            month_key = p.strftime('%Y-%m')
            if month_key in monthly_map:
                monthly_map[month_key] += float(r.get('repair_cost') or 0)

        monthly_maintenance_cost = [
            {'month': key, 'cost': round(value, 2)}
            for key, value in sorted(monthly_map.items())
        ]

        # Most used tools
        most_used_tools = sorted(
            [{'die_code': d.get('die_code') or '-', 'strokes': int(d.get('total_strokes') or 0)} for d in dies],
            key=lambda x: x['strokes'],
            reverse=True
        )[:10]

        # Breakdown analysis by ticket status (last 90 days)
        breakdown_window = (now_dt - timedelta(days=90)).isoformat()
        tickets = db_retry(lambda: supabase.table('tickets')\
            .select('status')\
            .gte('created_at', breakdown_window)\
            .execute())
        status_counts = {}
        for t in (tickets.data or []):
            status = str(t.get('status') or 'UNKNOWN')
            status_counts[status] = status_counts.get(status, 0) + 1
        breakdown_analysis = [
            {'status': k, 'count': v}
            for k, v in sorted(status_counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        return jsonify({
            'success': True,
            'data': {
                'kpis': {
                    'total_tools': total_tools,
                    'tools_in_production': tools_in_production,
                    'tools_in_maintenance': tools_in_maintenance,
                    'tools_near_breakdown': tools_near_breakdown,
                    'maintenance_due_today': maintenance_due_today
                },
                'monthly_maintenance_cost': monthly_maintenance_cost,
                'most_used_tools': most_used_tools,
                'breakdown_analysis': breakdown_analysis
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/repairs/recent', methods=['GET'])
@login_required
def get_recent_repairs():
    """Get recent repair details with ticket and die context."""
    try:
        limit = int(request.args.get('limit', 30))
        limit = max(1, min(limit, 200))

        try:
            repairs = db_retry(lambda: supabase.table('repair_work')\
                .select('id, ticket_id, work_sequence, root_cause, action_taken, spare_parts_used, downtime_minutes, repair_cost, performed_by, performed_at, before_repair_image, after_repair_image')\
                .order('performed_at', desc=True)\
                .limit(limit)\
                .execute())
        except Exception:
            repairs = db_retry(lambda: supabase.table('repair_work')\
                .select('id, ticket_id, work_sequence, root_cause, action_taken, spare_parts_used, downtime_minutes, performed_by, performed_at, before_repair_image, after_repair_image')\
                .order('performed_at', desc=True)\
                .limit(limit)\
                .execute())

        repair_rows = repairs.data or []
        ticket_ids = sorted({r.get('ticket_id') for r in repair_rows if r.get('ticket_id') is not None})

        tickets_by_id = {}
        dies_by_id = {}
        quality_map = {}

        if ticket_ids:
            tickets = db_retry(lambda: supabase.table('tickets')\
                .select('id, ticket_number, die_id, status, title')\
                .in_('id', ticket_ids)\
                .execute())
            tickets_by_id = {t['id']: t for t in (tickets.data or [])}

            die_ids = sorted({t.get('die_id') for t in (tickets.data or []) if t.get('die_id') is not None})
            if die_ids:
                dies = db_retry(lambda: supabase.table('dies')\
                    .select('id, die_code, position')\
                    .in_('id', die_ids)\
                    .execute())
                dies_by_id = {d['id']: d for d in (dies.data or [])}

            qualities = db_retry(lambda: supabase.table('quality_checks')\
                .select('ticket_id, check_sequence, result, comments, rework_reason, checked_at')\
                .in_('ticket_id', ticket_ids)\
                .execute())
            quality_map = {
                (q.get('ticket_id'), q.get('check_sequence')): q
                for q in (qualities.data or [])
            }

        merged = []
        for repair in repair_rows:
            ticket = tickets_by_id.get(repair.get('ticket_id'), {})
            die = dies_by_id.get(ticket.get('die_id'), {})
            quality = quality_map.get((repair.get('ticket_id'), repair.get('work_sequence')))
            merged.append({
                **repair,
                'ticket_number': ticket.get('ticket_number'),
                'ticket_status': ticket.get('status'),
                'ticket_title': ticket.get('title'),
                'die_id': ticket.get('die_id'),
                'die_code': die.get('die_code'),
                'die_position': die.get('position'),
                'quality': quality
            })

        return jsonify({'success': True, 'data': merged})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/history/recent', methods=['GET'])
@login_required
def get_recent_tool_history():
    """Get recent tool (die) history records."""
    try:
        limit = int(request.args.get('limit', 50))
        limit = max(1, min(limit, 500))

        history = db_retry(lambda: supabase.table('die_history')\
            .select('id, die_id, machine_id, event_type, ticket_number, description, created_by, created_at')\
            .order('created_at', desc=True)\
            .limit(limit)\
            .execute())

        rows = history.data or []
        die_ids = sorted({h.get('die_id') for h in rows if h.get('die_id') is not None})
        dies_by_id = {}
        if die_ids:
            dies = db_retry(lambda: supabase.table('dies')\
                .select('id, die_code')\
                .in_('id', die_ids)\
                .execute())
            dies_by_id = {d['id']: d for d in (dies.data or [])}

        enriched = []
        for item in rows:
            die = dies_by_id.get(item.get('die_id'), {})
            enriched.append({
                **item,
                'die_code': die.get('die_code')
            })

        return jsonify({'success': True, 'data': enriched})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== STROKE RECORDING FUNCTION ====================
def record_stroke(machine_id, die_id):
    """Record a stroke and check for tickets"""
    try:
        shift = get_current_shift()
        today = date.today().isoformat()
        fallback_shift = os.getenv('SHIFT_FALLBACK', 'B').strip().upper() or 'B'

        def upsert_daily(selected_shift):
            daily = db_retry(lambda: supabase.table('daily_production')\
                .select('stroke_count')\
                .eq('die_id', die_id)\
                .eq('machine_id', machine_id)\
                .eq('production_date', today)\
                .eq('shift', selected_shift)\
                .execute())

            if daily.data:
                new_count = daily.data[0]['stroke_count'] + 1
                db_retry(lambda: supabase.table('daily_production').update({
                    'stroke_count': new_count
                }).eq('die_id', die_id)\
                  .eq('machine_id', machine_id)\
                  .eq('production_date', today)\
                  .eq('shift', selected_shift)\
                  .execute())
            else:
                db_retry(lambda: supabase.table('daily_production').insert({
                    'die_id': die_id,
                    'machine_id': machine_id,
                    'production_date': today,
                    'shift': selected_shift,
                    'stroke_count': 1
                }).execute())
        
        # Update daily production (with shift fallback if DB shift constraint differs)
        try:
            upsert_daily(shift)
        except Exception as e:
            err_txt = str(e)
            if 'daily_production_shift_check' in err_txt or "'code': '23514'" in err_txt:
                if shift != fallback_shift:
                    print(f"[STROKE] Shift '{shift}' rejected by DB constraint, falling back to '{fallback_shift}'")
                    upsert_daily(fallback_shift)
                else:
                    raise
            else:
                raise
        
        # Get total strokes for die
        total_result = db_retry(lambda: supabase.table('daily_production')\
            .select('stroke_count')\
            .eq('die_id', die_id)\
            .execute())
        
        total_strokes = sum(item['stroke_count'] for item in total_result.data)
        
        # Update die total strokes
        db_retry(lambda: supabase.table('dies').update({
            'total_strokes': total_strokes,
            'updated_at': datetime.now().isoformat()
        }).eq('id', die_id).execute())
        
        # Insert stroke count
        db_retry(lambda: supabase.table('stroke_counts').insert({
            'die_id': die_id,
            'machine_id': machine_id,
            'stroke_count': total_strokes,
            'reading_time': datetime.now().isoformat()
        }).execute())
        
        system_status['total_strokes'] += 1
        
        # Check and create tickets (will be handled by ticket_generator.py)
        from ticket_generator import check_and_create_tickets
        check_and_create_tickets(die_id, total_strokes)
        
        return True
        
    except Exception as e:
        print(f"[STROKE ERROR] {e}")
        return False

# ==================== PLC MONITORING ====================
def monitor_plc():
    """Monitor PLC for stroke signals"""
    global plc_connected, previous_states, system_status
    
    try:
        import pymcprotocol
    except ImportError:
        print("ERROR: pymcprotocol not installed. Run: pip install pymcprotocol")
        return
    
    plc = None
    reconnect_delay = max(0.5, PLC_RECONNECT_DELAY)
    
    while monitoring_active:
        try:
            if not plc_connected:
                try:
                    if plc:
                        try:
                            plc.close()
                        except:
                            pass
                    
                    print(f"[PLC] Connecting to {PLC_IP}:{PLC_PORT}...")
                    last_error = None
                    for protocol in protocol_candidates():
                        try:
                            candidate = create_plc_client(pymcprotocol, protocol)
                            candidate.connect(PLC_IP, PLC_PORT)
                            # Warmup read to fail fast on invalid session/protocol.
                            candidate.batchread_bitunits(headdevice="M10", readsize=1)
                            plc = candidate
                            plc_connected = True
                            system_status['plc_connected'] = True
                            reconnect_delay = max(0.5, PLC_RECONNECT_DELAY)
                            print(f"[PLC] Connected successfully using {protocol}")
                            break
                        except Exception as candidate_error:
                            last_error = candidate_error
                            try:
                                candidate.close()
                            except Exception:
                                pass
                    if not plc_connected:
                        raise last_error or Exception("Unknown PLC connection error")
                except Exception as e:
                    plc_connected = False
                    system_status['plc_connected'] = False
                    previous_states = {}
                    print(f"[PLC] Connect failed: {e}")
                    time.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, PLC_MAX_RECONNECT_DELAY)
                    continue
            
            # Read PLC inputs (M10 to M36)
            values = plc.batchread_bitunits(headdevice="M10", readsize=27)
            
            if values and len(values) == 27:
                system_status['last_plc_read'] = datetime.now().isoformat()
                die_by_machine = update_active_die_cache()
                plc_machine_map = update_plc_machine_map_cache()
                
                for i, state in enumerate(values):
                    addr = 10 + i
                    machine_id = plc_machine_map.get(addr)
                    prev_state = previous_states.get(addr, False)
                    
                    if state and not prev_state:
                        # Rising edge - stroke occurred
                        if machine_id and machine_id in die_by_machine:
                            die_id = die_by_machine[machine_id]
                            record_stroke(machine_id, die_id)
                    
                    previous_states[addr] = state
            
            time.sleep(PLC_SCAN_INTERVAL)
            
        except Exception as e:
            print(f"[PLC] Error: {e}")
            plc_connected = False
            system_status['plc_connected'] = False
            previous_states = {}
            if plc:
                try:
                    plc.close()
                except:
                    pass
                plc = None
            time.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, PLC_MAX_RECONNECT_DELAY)

def start_plc_monitor():
    """Start PLC monitor thread once."""
    global plc_thread

    if not PLC_MONITOR_ENABLED:
        print("[PLC] Monitoring disabled via PLC_MONITOR_ENABLED=false")
        return

    if plc_thread and plc_thread.is_alive():
        return

    plc_thread = threading.Thread(target=monitor_plc, daemon=True)
    plc_thread.start()

# ==================== MAIN ====================
if __name__ == '__main__':
    print("\n" + "="*80)
    print("ðŸ”§ DIE HEALTH MONITORING SYSTEM - MAINTENANCE 2.0")
    print("="*80)
    print(f"Supabase URL: {SUPABASE_URL}")
    print(f"Supabase Key Mode: {'service_role' if HAS_SERVICE_ROLE_KEY else 'anon (RLS-limited)'}")
    print(f"PLC: {PLC_IP}:{PLC_PORT}")
    print("\nðŸ“‹ Default Users:")
    print("   production / prod123")
    print("   maintenance / maint123")
    print("   quality / quality123")
    print("   management / mgmt123")
    print("   admin / admin123")
    print("="*80)
    print("ðŸš€ Server starting on http://localhost:5000")
    print("="*80)
    
    print('PLC Monitoring: ' + ('Enabled' if PLC_MONITOR_ENABLED else 'Disabled'))

    flask_debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'

    # In debug mode, Werkzeug starts parent + child; start PLC monitor only in child.
    if (not flask_debug) or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_plc_monitor()

    app.run(host='0.0.0.0', port=5000, debug=flask_debug, threaded=True, use_reloader=flask_debug)
