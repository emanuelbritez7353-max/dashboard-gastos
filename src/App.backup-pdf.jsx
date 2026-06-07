import { useEffect, useMemo, useState } from "react";
import "./App.css";

const STORAGE_KEY = "dashboard_gastos";

const gastosIniciales = [
  {
    id: crypto.randomUUID(),
    descripcion: "Celular Samsung",
    categoria: "Tecnología",
    montoTotal: 600000,
    cuotas: 12,
    cuotaActual: 3,
    fechaCompra: "2026-06-01",
    tarjeta: "Visa BBVA",
  },
  {
    id: crypto.randomUUID(),
    descripcion: "Préstamo personal",
    categoria: "Préstamo",
    montoTotal: 1200000,
    cuotas: 24,
    cuotaActual: 5,
    fechaCompra: "2026-01-10",
    tarjeta: "Santander",
  },
];

function normalizarGastos(gastos) {
  return gastos.map((gasto) => ({
    ...gasto,
    id: gasto.id || crypto.randomUUID(),
    montoTotal: Number(gasto.montoTotal),
    cuotas: Number(gasto.cuotas),
    cuotaActual: Number(gasto.cuotaActual),
  }));
}

function cargarGastosGuardados() {
  const datosGuardados = localStorage.getItem(STORAGE_KEY);

  if (!datosGuardados) {
    return gastosIniciales;
  }

  try {
    return normalizarGastos(JSON.parse(datosGuardados));
  } catch {
    return gastosIniciales;
  }
}

function formatearDinero(valor) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(valor || 0);
}

function sumarMeses(fecha, meses) {
  const nuevaFecha = new Date(fecha);
  nuevaFecha.setMonth(nuevaFecha.getMonth() + meses);
  return nuevaFecha;
}

function formatearMes(fecha) {
  return fecha.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
}

function limpiarFormulario() {
  return {
    id: "",
    descripcion: "",
    categoria: "",
    montoTotal: "",
    cuotas: "",
    cuotaActual: "",
    fechaCompra: "",
    tarjeta: "",
  };
}

export default function App() {
  const [gastos, setGastos] = useState(cargarGastosGuardados);
  const [formulario, setFormulario] = useState(limpiarFormulario());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gastos));
  }, [gastos]);

  const gastosCalculados = useMemo(() => {
    return gastos.map((gasto) => {
      const valorCuota = gasto.montoTotal / gasto.cuotas;
      const cuotasPendientes = gasto.cuotas - gasto.cuotaActual;
      const fechaFinalizacion = sumarMeses(gasto.fechaCompra, gasto.cuotas - 1);

      return {
        ...gasto,
        valorCuota,
        cuotasPendientes,
        fechaFinalizacion,
      };
    });
  }, [gastos]);

  const totalMensual = gastosCalculados.reduce(
    (total, gasto) => total + gasto.valorCuota,
    0
  );

  const totalDeudaPendiente = gastosCalculados.reduce(
    (total, gasto) => total + gasto.valorCuota * gasto.cuotasPendientes,
    0
  );

  const proyeccion = useMemo(() => {
    const meses = {};

    gastosCalculados.forEach((gasto) => {
      for (let i = gasto.cuotaActual; i < gasto.cuotas; i++) {
        const fecha = sumarMeses(gasto.fechaCompra, i);
        const mes = formatearMes(fecha);

        if (!meses[mes]) {
          meses[mes] = 0;
        }

        meses[mes] += gasto.valorCuota;
      }
    });

    return Object.entries(meses).map(([mes, total]) => ({
      mes,
      total,
    }));
  }, [gastosCalculados]);

  function actualizarFormulario(evento) {
    const { name, value } = evento.target;

    setFormulario({
      ...formulario,
      [name]: value,
    });
  }

  function guardarGasto(evento) {
    evento.preventDefault();

    const gastoGuardado = {
      id: formulario.id || crypto.randomUUID(),
      descripcion: formulario.descripcion,
      categoria: formulario.categoria,
      montoTotal: Number(formulario.montoTotal),
      cuotas: Number(formulario.cuotas),
      cuotaActual: Number(formulario.cuotaActual),
      fechaCompra: formulario.fechaCompra,
      tarjeta: formulario.tarjeta,
    };

    if (gastoGuardado.cuotaActual > gastoGuardado.cuotas) {
      alert("La cuota actual no puede ser mayor que la cantidad total de cuotas.");
      return;
    }

    if (formulario.id) {
      setGastos(
        gastos.map((gasto) =>
          gasto.id === formulario.id ? gastoGuardado : gasto
        )
      );
    } else {
      setGastos([...gastos, gastoGuardado]);
    }

    setFormulario(limpiarFormulario());
  }

  function cargarGastoParaEditar(gasto) {
    setFormulario({
      id: gasto.id,
      descripcion: gasto.descripcion,
      categoria: gasto.categoria,
      montoTotal: gasto.montoTotal,
      cuotas: gasto.cuotas,
      cuotaActual: gasto.cuotaActual,
      fechaCompra: gasto.fechaCompra,
      tarjeta: gasto.tarjeta,
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function cancelarEdicion() {
    setFormulario(limpiarFormulario());
  }

  function eliminarGasto(id) {
    const confirmar = window.confirm("¿Querés eliminar este gasto?");

    if (!confirmar) {
      return;
    }

    setGastos(gastos.filter((gasto) => gasto.id !== id));
  }

  function borrarTodo() {
    const confirmar = window.confirm(
      "¿Seguro que querés borrar todos los gastos cargados?"
    );

    if (!confirmar) {
      return;
    }

    setGastos([]);
    setFormulario(limpiarFormulario());
  }

  return (
    <main className="contenedor">
      <section className="hero">
        <p className="etiqueta">Dashboard financiero personal</p>
        <h1>Métricas de gastos y cuotas</h1>
        <p>
          Cargá compras, préstamos o pagos en cuotas y visualizá cuánto te queda
          por pagar y cómo se proyectan tus gastos a futuro.
        </p>
      </section>

      <section className="resumen">
        <div className="tarjeta">
          <span>Total mensual estimado</span>
          <strong>{formatearDinero(totalMensual)}</strong>
        </div>

        <div className="tarjeta">
          <span>Deuda pendiente</span>
          <strong>{formatearDinero(totalDeudaPendiente)}</strong>
        </div>

        <div className="tarjeta">
          <span>Gastos cargados</span>
          <strong>{gastos.length}</strong>
        </div>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={guardarGasto}>
          <h2>{formulario.id ? "Editar gasto" : "Cargar gasto"}</h2>

          {formulario.id && (
            <p className="modo-edicion">
              Editando: <strong>{formulario.descripcion}</strong>
            </p>
          )}

          <input
            name="descripcion"
            placeholder="Descripción"
            value={formulario.descripcion}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="categoria"
            placeholder="Categoría"
            value={formulario.categoria}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="montoTotal"
            type="number"
            placeholder="Monto total"
            value={formulario.montoTotal}
            onChange={actualizarFormulario}
            min="1"
            required
          />

          <input
            name="cuotas"
            type="number"
            placeholder="Cantidad total de cuotas"
            value={formulario.cuotas}
            onChange={actualizarFormulario}
            min="1"
            required
          />

          <input
            name="cuotaActual"
            type="number"
            placeholder="Cuota actual"
            value={formulario.cuotaActual}
            onChange={actualizarFormulario}
            min="0"
            required
          />

          <input
            name="fechaCompra"
            type="date"
            value={formulario.fechaCompra}
            onChange={actualizarFormulario}
            required
          />

          <input
            name="tarjeta"
            placeholder="Tarjeta, banco o entidad"
            value={formulario.tarjeta}
            onChange={actualizarFormulario}
            required
          />

          <button type="submit">
            {formulario.id ? "Guardar cambios" : "Agregar gasto"}
          </button>

          {formulario.id && (
            <button
              type="button"
              className="boton-secundario"
              onClick={cancelarEdicion}
            >
              Cancelar edición
            </button>
          )}
        </form>

        <section className="panel">
          <div className="encabezado-panel">
            <h2>Proyección futura</h2>
          </div>

          <div className="lista">
            {proyeccion.length === 0 ? (
              <p className="vacio">No hay cuotas futuras cargadas.</p>
            ) : (
              proyeccion.map((item) => (
                <div className="fila" key={item.mes}>
                  <span>{item.mes}</span>
                  <strong>{formatearDinero(item.total)}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="encabezado-panel">
          <h2>Cuotas activas</h2>

          {gastos.length > 0 && (
            <button className="boton-peligro" onClick={borrarTodo}>
              Borrar todo
            </button>
          )}
        </div>

        <div className="tabla">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Entidad</th>
                <th>Cuota</th>
                <th>Valor cuota</th>
                <th>Pendientes</th>
                <th>Finaliza</th>
                <th>Acción</th>
              </tr>
            </thead>

            <tbody>
              {gastosCalculados.map((gasto) => (
                <tr key={gasto.id}>
                  <td>{gasto.descripcion}</td>
                  <td>{gasto.categoria}</td>
                  <td>{gasto.tarjeta}</td>
                  <td>
                    {gasto.cuotaActual}/{gasto.cuotas}
                  </td>
                  <td>{formatearDinero(gasto.valorCuota)}</td>
                  <td>{gasto.cuotasPendientes}</td>
                  <td>{formatearMes(gasto.fechaFinalizacion)}</td>
                  <td>
                    <div className="acciones">
                      <button
                        type="button"
                        className="boton-editar"
                        onClick={() => cargarGastoParaEditar(gasto)}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        className="boton-eliminar"
                        onClick={() => eliminarGasto(gasto.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {gastosCalculados.length === 0 && (
                <tr>
                  <td colSpan="8" className="vacio">
                    No hay gastos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
