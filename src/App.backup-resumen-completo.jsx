import { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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

function convertirFecha(fechaTexto) {
  const partes = fechaTexto.split("/");
  const dia = partes[0].padStart(2, "0");
  const mes = partes[1].padStart(2, "0");
  let anio = partes[2];

  if (!anio) {
    anio = new Date().getFullYear().toString();
  }

  if (anio.length === 2) {
    anio = "20" + anio;
  }

  return `${anio}-${mes}-${dia}`;
}

function convertirMonto(montoTexto) {
  return Number(
    montoTexto
      .replace("$", "")
      .replace("ARS", "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

function extraerTextoOrdenado(contenido) {
  const items = contenido.items
    .filter((item) => item.str && item.str.trim() !== "")
    .map((item) => ({
      texto: item.str,
      x: item.transform[4],
      y: Math.round(item.transform[5]),
    }));

  const lineas = {};

  items.forEach((item) => {
    if (!lineas[item.y]) {
      lineas[item.y] = [];
    }

    lineas[item.y].push(item);
  });

  return Object.keys(lineas)
    .sort((a, b) => Number(b) - Number(a))
    .map((y) =>
      lineas[y]
        .sort((a, b) => a.x - b.x)
        .map((item) => item.texto)
        .join(" ")
    )
    .join("\n");
}

function detectarGastosDesdeTexto(textoPDF, nombrePDF) {
  const lineas = textoPDF
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  const gastosDetectados = [];

  lineas.forEach((linea) => {
    const fechaEncontrada = linea.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);

    const montosEncontrados = linea.match(
      /(?:\$|ARS)?\s*-?\d{1,3}(?:\.\d{3})+(?:,\d{2})?|(?:\$|ARS)?\s*-?\d+,\d{2}/gi
    );

    if (!fechaEncontrada || !montosEncontrados) {
      return;
    }

    const montoTexto = montosEncontrados[montosEncontrados.length - 1];
    const monto = convertirMonto(montoTexto);

    if (!monto || monto <= 0) {
      return;
    }

    const cuotaEncontrada = linea.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);

    let cuotaActual = 1;
    let cuotas = 1;

    if (cuotaEncontrada) {
      cuotaActual = Number(cuotaEncontrada[1]);
      cuotas = Number(cuotaEncontrada[2]);

      if (cuotaActual > cuotas || cuotas > 60) {
        cuotaActual = 1;
        cuotas = 1;
      }
    }

    let descripcion = linea
      .replace(fechaEncontrada[0], "")
      .replace(montoTexto, "")
      .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
      .replace(/ARS/gi, "")
      .replace(/\$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (descripcion.length < 3) {
      descripcion = "Consumo detectado";
    }

    gastosDetectados.push({
      id: crypto.randomUUID(),
      descripcion,
      categoria: cuotas > 1 ? "Cuotas" : "Consumo",
      montoTotal: cuotas > 1 ? monto * cuotas : monto,
      cuotas,
      cuotaActual,
      fechaCompra: convertirFecha(fechaEncontrada[0]),
      tarjeta: nombrePDF || "Resumen PDF",
      origen: "PDF",
      lineaOriginal: linea,
    });
  });

  return gastosDetectados;
}

export default function App() {
  const [gastos, setGastos] = useState(cargarGastosGuardados);
  const [formulario, setFormulario] = useState(limpiarFormulario());

  const [textoPDF, setTextoPDF] = useState("");
  const [nombrePDF, setNombrePDF] = useState("");
  const [leyendoPDF, setLeyendoPDF] = useState(false);
  const [gastosPDF, setGastosPDF] = useState([]);

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

  async function leerPDF(evento) {
    const archivo = evento.target.files[0];

    if (!archivo) {
      return;
    }

    if (archivo.type !== "application/pdf") {
      alert("Por favor subí un archivo PDF.");
      return;
    }

    setLeyendoPDF(true);
    setNombrePDF(archivo.name);
    setTextoPDF("");
    setGastosPDF([]);

    try {
      const buffer = await archivo.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

      let textoCompleto = "";

      for (let paginaNumero = 1; paginaNumero <= pdf.numPages; paginaNumero++) {
        const pagina = await pdf.getPage(paginaNumero);
        const contenido = await pagina.getTextContent();
        const textoPagina = extraerTextoOrdenado(contenido);

        textoCompleto += `\n\n--- Página ${paginaNumero} ---\n${textoPagina}`;
      }

      const textoFinal = textoCompleto.trim();
      const gastosDetectados = detectarGastosDesdeTexto(textoFinal, archivo.name);

      setTextoPDF(textoFinal);
      setGastosPDF(gastosDetectados);
    } catch (error) {
      console.error(error);
      alert("No se pudo leer el PDF. Puede estar protegido o venir como imagen.");
    } finally {
      setLeyendoPDF(false);
    }
  }

  function importarGastosPDF() {
    if (gastosPDF.length === 0) {
      alert("No hay gastos detectados para importar.");
      return;
    }

    setGastos([...gastos, ...gastosPDF]);
    setGastosPDF([]);
    alert("Gastos importados correctamente.");
  }

  function eliminarGastoDetectado(id) {
    setGastosPDF(gastosPDF.filter((gasto) => gasto.id !== id));
  }

  function limpiarPDF() {
    setTextoPDF("");
    setNombrePDF("");
    setGastosPDF([]);
  }

  return (
    <main className="contenedor">
      <section className="hero">
        <p className="etiqueta">Dashboard financiero personal</p>
        <h1>Métricas de gastos y cuotas</h1>
        <p>
          Cargá resúmenes bancarios en PDF, detectá consumos automáticamente y
          visualizá cómo se proyectan tus gastos a futuro.
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

      <section className="panel">
        <div className="encabezado-panel">
          <div>
            <h2>Cargar resumen bancario en PDF</h2>
            <p className="texto-ayuda">
              Subí tu resumen. La app intentará detectar automáticamente los
              consumos con fecha, descripción, monto y cuotas.
            </p>
          </div>

          {(textoPDF || gastosPDF.length > 0) && (
            <button className="boton-secundario" onClick={limpiarPDF}>
              Limpiar PDF
            </button>
          )}
        </div>

        <input type="file" accept="application/pdf" onChange={leerPDF} />

        {leyendoPDF && <p className="modo-edicion">Leyendo y analizando PDF...</p>}

        {nombrePDF && !leyendoPDF && (
          <p className="modo-edicion">
            PDF cargado: <strong>{nombrePDF}</strong>
          </p>
        )}

        {gastosPDF.length > 0 && (
          <div className="bloque-detectados">
            <div className="encabezado-panel">
              <h3>Gastos detectados automáticamente</h3>

              <button onClick={importarGastosPDF}>
                Importar {gastosPDF.length} gastos
              </button>
            </div>

            <div className="tabla">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th>Monto total</th>
                    <th>Cuotas</th>
                    <th>Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {gastosPDF.map((gasto) => (
                    <tr key={gasto.id}>
                      <td>{gasto.fechaCompra}</td>
                      <td>{gasto.descripcion}</td>
                      <td>{gasto.categoria}</td>
                      <td>{formatearDinero(gasto.montoTotal)}</td>
                      <td>
                        {gasto.cuotaActual}/{gasto.cuotas}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="boton-eliminar"
                          onClick={() => eliminarGastoDetectado(gasto.id)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="texto-ayuda">
              Revisá la tabla antes de importar. Si detecta algo mal, podés
              quitarlo y luego cargarlo manualmente.
            </p>
          </div>
        )}

        {nombrePDF && !leyendoPDF && gastosPDF.length === 0 && (
          <p className="advertencia">
            No se detectaron gastos automáticamente. Puede que el PDF tenga otro
            formato o que sea una imagen escaneada.
          </p>
        )}

        {textoPDF && (
          <details className="detalle-pdf">
            <summary>Ver texto extraído del PDF</summary>
            <textarea className="visor-pdf" value={textoPDF} readOnly />
          </details>
        )}
      </section>

      <section className="grid">
        <form className="panel" onSubmit={guardarGasto}>
          <h2>{formulario.id ? "Editar gasto" : "Cargar gasto manual"}</h2>

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
          <h2>Proyección futura</h2>

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
