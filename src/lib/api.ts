// Cliente da API do Credix (Laravel + Sanctum).

export interface Company {
  id: string
  name: string
  slug: string
  pix_online: boolean
}

export interface User {
  id: string
  name: string
  first_name: string
  email: string
  company_id: string
  company?: Company
  roles: string[]
}

export interface Product {
  id: string
  code: string | number | null
  name: string
  sku: string | null
  price: number
  stock: number | null
  active: boolean
}

export interface Customer {
  id: string
  code: string | number | null
  name: string
  cpf_formatted: string | null
  phone_formatted: string | null
  overdue_count?: number
}

export interface Installment {
  id: string
  installment_number: number
  amount: number
  due_date: string
  status: string
}

export interface Sale {
  id: string
  code: string
  status: string
  payment_type: string
  subtotal: number
  discount: number
  total: number
  created_at_formatted: string
  customer: { id: string; name: string } | null
  items?: { product_name: string; quantity: number; unit_price: number; subtotal: number }[]
  installments?: Installment[]
}

export interface Receipt {
  id: string
  code: string
  status: string
  total: number
  principal: number
  surcharge: number
  surcharge_waived: number
  discount: number
  change: number
  methods: { type: string; amount: number }[]
  public_url: string | null
  whatsapp_message: string | null
  installments: unknown
  created_at: string
}

export interface PixCharge {
  id: string
  origin: string
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | string
  amount: number
  qr_code: string
  qr_code_base64: string
  expires_at: string
  sale_id: string | null
  receipt: Receipt | null
}

export interface OpenInstallment {
  id: string
  sale_id: string
  sale_code: string
  installment_number: number
  is_down_payment: boolean
  due_date: string
  days_late: number
  principal: number
  surcharge: number
}

export interface Receivable {
  customer: { id: string; name: string; phone: string | null }
  permissions: { waive_surcharge: boolean; discount: boolean; adjustment: boolean; reverse: boolean }
  pix_online: boolean
  total_due: number
  installments: OpenInstallment[]
  preview: {
    amount: number
    principal: number
    surcharge: number
    waived: number
    rows: { installment_id: string; principal_paid: number; surcharge_paid: number; remaining_after: number; settled: boolean }[]
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public errors: Record<string, string[]> = {}) {
    super(message)
  }
}

export class Api {
  constructor(private baseUrl: string, private token: string | null = null, private onUnauthorized?: () => void) {}

  setToken(token: string | null) {
    this.token = token
  }

  private url(path: string, query?: Record<string, unknown>): string {
    const u = new URL(`${this.baseUrl.replace(/\/+$/, '')}/api/${path.replace(/^\/+/, '')}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(`${k}[]`, String(x)))
      else u.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    }
    return u.toString()
  }

  async request<T>(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch {
      throw new ApiError('Sem conexão com o servidor. Confira a internet e tente de novo.', 0)
    }

    const data = await res.json().catch(() => null)
    if (res.ok) return data as T

    if (res.status === 401 && this.token) this.onUnauthorized?.()
    const errors: Record<string, string[]> = data?.errors ?? {}
    const first = Object.values(errors)[0]?.[0]
    const message =
      first ??
      data?.message ??
      (res.status === 403 ? 'Você não tem permissão para isso.' : `Erro no servidor (${res.status}).`)
    throw new ApiError(message, res.status, errors)
  }

  // Auth
  login(email: string, password: string) {
    return this.request<{ token: string; user: User }>('POST', 'auth/login', {
      body: { email, password, device_name: 'credix-desktop' },
    })
  }
  me() {
    return this.request<{ user: User }>('GET', 'auth/me')
  }
  logout() {
    return this.request('POST', 'auth/logout')
  }
  sellers() {
    return this.request<{ id: string; name: string }[]>('GET', 'sellers')
  }

  // Produtos
  products(search: string, perPage = 12) {
    return this.request<{ data: Product[] }>('GET', 'products', { query: { search, per_page: perPage } })
  }
  productBySku(code: string) {
    return this.request<{ data: Product }>('GET', `products/sku/${encodeURIComponent(code)}`)
  }

  // Clientes
  customers(search: string) {
    return this.request<{ data: Customer[] }>('GET', 'customers', { query: { search } })
  }

  // Vendas
  createSale(body: Record<string, unknown>) {
    return this.request<Sale & { pix: PixCharge | null }>('POST', 'sales', { body })
  }
  sale(id: string) {
    return this.request<Sale>('GET', `sales/${id}`)
  }

  // Recebimento
  receivable(customerId: string, query: { amount?: number; installment_ids?: string[]; waive_surcharge?: boolean } = {}) {
    return this.request<Receivable>('GET', `customers/${customerId}/receivable`, { query })
  }
  receive(body: Record<string, unknown>) {
    return this.request<Receipt>('POST', 'receipts', { body })
  }

  // Pix online
  createPix(body: Record<string, unknown>) {
    return this.request<PixCharge>('POST', 'pix-charges', { body })
  }
  pix(id: string) {
    return this.request<PixCharge>('GET', `pix-charges/${id}`)
  }
  cancelPix(id: string) {
    return this.request<PixCharge>('POST', `pix-charges/${id}/cancel`)
  }
}
