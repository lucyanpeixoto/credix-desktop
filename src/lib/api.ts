// Cliente da API do Credix (Laravel + Sanctum).

export interface Company {
  id: string
  name: string
  legal_name: string
  phone: string | null
  address: string | null
  logo_url: string | null
  pix_online: boolean
  late_charges: boolean
  cash_control: boolean
}

export interface Seller {
  id: string
  name: string
  first_name: string
  initials: string
  role: 'owner' | 'manager' | 'seller' | string | null
  can_manage: boolean
  has_pin: boolean
}

export interface TerminalInfo {
  terminal: { id: string; name: string; lock_minutes: number }
  company: Company
  sellers: Seller[]
}

export interface CashMethod {
  type: string
  label: string
  count: number
  total: number
}

export interface CashSummary {
  opening: number
  methods: CashMethod[]
  total_in: number
  crediario_sold: number
  sangria: number
  suprimento: number
  expected_cash: number
}

export interface CashMovement {
  id: string
  type: 'sangria' | 'suprimento'
  amount: number
  reason: string | null
  user: string | null
  created_at: string
}

export interface CashSession {
  id: string
  status: 'open' | 'closed'
  opened_at: string
  opened_by: string | null
  closed_at: string | null
  closed_by: string | null
  counted_cash: number | null
  difference: number | null
  notes: string | null
  summary: CashSummary
  movements: CashMovement[]
}

export interface CashState {
  enabled: boolean
  session: CashSession | null
  last_closed: { closed_at: string; counted_cash: number; closed_by: string | null } | null
}

export interface Category {
  id: string
  name: string
  parent_id?: string | null
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
  constructor(
    message: string,
    public status: number,
    public errors: Record<string, string[]> = {},
    public code: string | null = null,
  ) {
    super(message)
  }
}

export interface Credentials {
  token: string | null
  sellerId: string | null
  pin: string | null
}

/**
 * Cliente da API do PDV desktop (/api/pdv). O computador entra com o token do
 * terminal; as chamadas de dados levam também o vendedor e o PIN dele.
 */
export class Api {
  constructor(
    private baseUrl: string,
    private creds: () => Credentials,
    private onUnpaired?: () => void,
    private onSellerRejected?: () => void,
    private onNetwork?: (ok: boolean) => void,
    private onCashClosed?: () => void,
  ) {}

  private url(path: string, query?: Record<string, unknown>): string {
    const u = new URL(`${this.baseUrl.replace(/\/+$/, '')}/api/pdv/${path.replace(/^\/+/, '')}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(`${k}[]`, String(x)))
      else u.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    }
    return u.toString()
  }

  async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown; seller?: boolean } = {},
  ): Promise<T> {
    const c = this.creds()
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (c.token) headers.Authorization = `Bearer ${c.token}`
    if (opts.seller !== false && c.sellerId && c.pin) {
      headers['X-Pdv-Seller'] = c.sellerId
      headers['X-Pdv-Pin'] = c.pin
    }

    let res: Response
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch {
      this.onNetwork?.(false)
      throw new ApiError('Sem conexão com o servidor. Confira a internet e tente de novo.', 0)
    }
    this.onNetwork?.(true)

    const data = await res.json().catch(() => null)
    if (res.ok) return data as T

    const code: string | null = data?.code ?? null
    if (res.status === 401 && code === 'terminal_unpaired') this.onUnpaired?.()
    else if (res.status === 401 && code === 'seller_locked' && opts.seller !== false) this.onSellerRejected?.()
    else if (res.status === 409 && code === 'cash_closed') this.onCashClosed?.()

    const errors: Record<string, string[]> = data?.errors ?? {}
    const first = Object.values(errors)[0]?.[0]
    const message =
      first ??
      data?.message ??
      (res.status === 403 ? 'Você não tem permissão para isso.' : `Erro no servidor (${res.status}).`)
    throw new ApiError(message, res.status, errors, code)
  }

  // Terminal
  pair(code: string, deviceName: string) {
    return this.request<TerminalInfo & { token: string }>('POST', 'pair', {
      body: { code, device_name: deviceName },
      seller: false,
    })
  }
  terminal() {
    return this.request<TerminalInfo>('GET', 'terminal', { seller: false })
  }
  unlock(sellerId: string, pin: string) {
    return this.request<{ seller: Seller }>('POST', 'unlock', { body: { seller_id: sellerId, pin }, seller: false })
  }
  disconnect(sellerId: string, pin: string) {
    return this.request<{ message: string }>('POST', 'disconnect', { body: { seller_id: sellerId, pin }, seller: false })
  }

  // Caixa
  cash() {
    return this.request<CashState>('GET', 'cash')
  }
  openCash(openingAmount: number) {
    return this.request<{ session: CashSession }>('POST', 'cash/open', { body: { opening_amount: openingAmount } })
  }
  cashMovement(type: 'sangria' | 'suprimento', amount: number, reason: string | null) {
    return this.request<{ movement: CashMovement; session: CashSession }>('POST', 'cash/movements', {
      body: { type, amount, reason },
    })
  }
  closeCash(countedCash: number, notes: string | null) {
    return this.request<{ session: CashSession }>('POST', 'cash/close', { body: { counted_cash: countedCash, notes } })
  }

  // Catálogo
  categories() {
    return this.request<{ data: Category[] }>('GET', 'categories')
  }
  products(search: string, perPage = 12, categoryId?: string | null) {
    return this.request<{ data: Product[] }>('GET', 'products', {
      query: { search, per_page: perPage, category_id: categoryId ?? undefined },
    })
  }
  productBySku(code: string) {
    return this.request<{ data: Product }>('GET', `products/sku/${encodeURIComponent(code)}`)
  }

  // Clientes
  customers(search: string) {
    return this.request<{ data: Customer[] }>('GET', 'customers', { query: { search } })
  }
  createCustomer(body: { name: string; cpf?: string | null; phone?: string | null }) {
    return this.request<Customer>('POST', 'customers', { body })
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
